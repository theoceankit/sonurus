"""Search of recordings by the text of their segments, their title and their note.

Hits are grouped by recording, recordings come newest first, and the hits of a
recording come in the order of the recording: the title, the segments by time,
then the note. The query language is in search_query; the index in
app/db/search_index.
"""

import re
import sqlite3
from datetime import date

from app.db import search_index
from app.services.search_query import parse_query

SNIPPET_WORDS = 30          # a longer text is cut to this many words around the first match
WORDS_BEFORE_MATCH = 10
MAX_SPEAKERS = 10
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_WORD = re.compile(r"\S+")
_HL_START, _HL_END = "\x02", "\x03"


class SearchRefused(ValueError):
    """A search that cannot run as asked; the message is one line for the user."""


class RecordingNotFound(LookupError):
    pass


class SearchService:
    def __init__(self, storage, memory):
        self.db_path = storage.db_path
        self.memory = memory

    def search(
        self,
        q: str,
        speaker: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        recording_id: int | None = None,
        limit: int = 20,
        offset: int = 0,
        hits_per_recording: int = 3,
    ) -> dict:
        """With recording_id, offset pages through the hits of that recording;
        otherwise through the recordings. Raises SearchQueryError or
        SearchRefused for a search that cannot run, RecordingNotFound."""
        parsed = parse_query(q)
        speaker_id, day_from, day_to = self.filters(speaker, date_from, date_to)

        conn = sqlite3.connect(self.db_path)
        try:
            if recording_id is not None and conn.execute(
                "SELECT 1 FROM transcriptions WHERE id = ?", (recording_id,)
            ).fetchone() is None:
                raise RecordingNotFound(f"Recording {recording_id} not found: search without recording_id to see the ids.")
            groups = self._groups(conn, parsed.match, speaker_id, day_from, day_to, recording_id)
            if recording_id is not None:
                page, hits_offset = groups, offset
            else:
                page, hits_offset = groups[offset:offset + limit], 0
            hits = self._hits(conn, parsed.match, speaker_id, [g[0] for g in page], hits_offset, hits_per_recording)
            info = self._recording_info(conn, [g[0] for g in page])
        finally:
            conn.close()

        recordings = [{
            "recording_id": tid,
            "title": info[tid]["title"],
            "created_at": info[tid]["created_at"],
            "duration_sec": info[tid]["duration_sec"],
            "hit_count": count,
            "hits": hits.get(tid, []),
        } for tid, count in page]
        return {
            "total_hits": sum(count for _, count in groups),
            "total_recordings": len(groups),
            "recordings": recordings,
            "speakers": self._speakers(parsed.words),
        }

    # ── Filters ───────────────────────────────────────────────────────────────

    def filters(self, speaker: str | None, date_from: str | None, date_to: str | None) -> tuple:
        """(speaker id, from, to) of a search, or of any list of recordings by
        the same filters. Raises SearchRefused for an unknown handle, a wrong
        date or from after to."""
        speaker_id = None
        if speaker:
            speaker_id = self.speaker_id(speaker)
            if speaker_id is None:
                raise SearchRefused(f"No speaker has the handle {handle_of(speaker)}: use the handle of a named speaker.")
        day_from = _day("from", date_from)
        day_to = _day("to", date_to)
        if day_from and day_to and day_from > day_to:
            raise SearchRefused("The from date comes after the to date: give a from date on or before the to date.")
        return speaker_id, day_from, day_to

    def speaker_id(self, speaker: str) -> str | None:
        """The speaker with this handle (a leading @ and the case do not matter), or None."""
        handle = handle_of(speaker)[1:]
        for spk_id, (known, _manual) in self.memory.known_handles.items():
            if known and known.lower() == handle:
                return spk_id
        return None

    # ── Queries ───────────────────────────────────────────────────────────────

    @staticmethod
    def _groups(conn, match, speaker_id, day_from, day_to, recording_id) -> list[tuple[int, int]]:
        """[(recording id, hit count)] of every recording with a hit, newest first."""
        segment_speaker = "AND s.speaker_id = :speaker" if speaker_id else ""
        lo = hi = None
        if recording_id is not None:
            # One recording: only the range of its segment ids, as in _hits().
            lo, hi = conn.execute(
                "SELECT MIN(id), MAX(id) FROM segments WHERE transcription_id = ?", (recording_id,)
            ).fetchone()
            segment_speaker += " AND search_segments.rowid BETWEEN :lo AND :hi"
        where = []
        if day_from:
            where.append("substr(t.created_at, 1, 10) >= :day_from")
        if day_to:
            where.append("substr(t.created_at, 1, 10) <= :day_to")
        if recording_id is not None:
            where.append("t.id = :recording_id")
        if speaker_id:
            where.append(
                "EXISTS (SELECT 1 FROM segments x WHERE x.transcription_id = t.id AND x.speaker_id = :speaker)"
            )
        rows = conn.execute(f"""
            WITH hits (tid) AS (
                SELECT s.transcription_id FROM search_segments CROSS JOIN segments s ON s.id = search_segments.rowid
                 WHERE search_segments MATCH :match {segment_speaker}
                UNION ALL
                SELECT rowid FROM search_titles WHERE search_titles MATCH :match
                UNION ALL
                SELECT transcription_id FROM search_notes WHERE search_notes MATCH :match
            )
            SELECT t.id, COUNT(*) FROM hits JOIN transcriptions t ON t.id = hits.tid
            {"WHERE " + " AND ".join(where) if where else ""}
            GROUP BY t.id
            ORDER BY t.created_at DESC, t.id DESC
        """, {"match": match, "speaker": speaker_id, "day_from": day_from, "day_to": day_to,
              "recording_id": recording_id, "lo": lo if lo is not None else 0,
              "hi": hi if hi is not None else -1}).fetchall()
        return [(tid, count) for tid, count in rows]

    def _hits(self, conn, match, speaker_id, tids, offset, per_recording) -> dict[int, list[dict]]:
        """The hits of each recording in tids, title first, then segments by time,
        then the note; per_recording of them from offset."""
        if not tids:
            return {}
        ids = ",".join(str(int(t)) for t in tids)
        # The segments of a recording are written together, so the ids of the
        # page's segments, the rowids of the index, lie in a narrow range:
        # FTS5 reads only that range instead of every match.
        lo, hi = conn.execute(f"SELECT MIN(id), MAX(id) FROM segments WHERE transcription_id IN ({ids})").fetchone()
        segment_speaker = "AND s.speaker_id = :speaker" if speaker_id else ""
        rows = conn.execute(f"""
            SELECT tid, kind, start, end, spk, unassigned, shown, hl FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY tid ORDER BY k, pos, ref) AS n FROM (
                    SELECT rowid AS tid, 0 AS k, 0 AS pos, rowid AS ref, 'title' AS kind,
                           NULL AS start, NULL AS end, NULL AS spk, 0 AS unassigned, shown,
                           highlight(search_titles, 0, char(2), char(3)) AS hl
                      FROM search_titles WHERE search_titles MATCH :match AND rowid IN ({ids})
                    UNION ALL
                    SELECT s.transcription_id, 1, s.start, s.id, 'segment',
                           s.start, s.end, s.speaker_id, s.unassigned, s.text,
                           highlight(search_segments, 0, char(2), char(3))
                      FROM search_segments CROSS JOIN segments s ON s.id = search_segments.rowid
                     WHERE search_segments MATCH :match AND search_segments.rowid BETWEEN :lo AND :hi
                       AND s.transcription_id IN ({ids}) {segment_speaker}
                    UNION ALL
                    SELECT transcription_id, 2, block, rowid, 'note',
                           NULL, NULL, NULL, 0, shown,
                           highlight(search_notes, 0, char(2), char(3))
                      FROM search_notes WHERE search_notes MATCH :match AND transcription_id IN ({ids})
                )
            ) WHERE n > :offset AND n <= :offset + :per_recording
            ORDER BY tid, n
        """, {"match": match, "speaker": speaker_id, "offset": offset, "per_recording": per_recording,
              "lo": lo if lo is not None else 0, "hi": hi if hi is not None else -1}).fetchall()

        hits: dict[int, list[dict]] = {}
        for tid, kind, start, end, spk, unassigned, shown, marked in rows:
            snippet, highlights = _snippet(shown, _marked_ranges(marked))
            hit = {"kind": kind, "start": start, "end": end, "speaker_id": None, "speaker_name": None,
                   "speaker_handle": None, "unassigned": False, "snippet": snippet, "highlights": highlights}
            if kind == "segment":
                hit["unassigned"] = bool(unassigned) or spk is None
                if spk is not None:
                    hit.update(speaker_id=spk, speaker_name=self.memory.get_name(spk),
                               speaker_handle=self.memory.get_handle(spk))
            hits.setdefault(tid, []).append(hit)
        return hits

    @staticmethod
    def _recording_info(conn, tids) -> dict[int, dict]:
        if not tids:
            return {}
        ids = ",".join(str(int(t)) for t in tids)
        rows = conn.execute(f"""
            SELECT t.id, t.title, t.audio_file, t.created_at,
                   (SELECT MAX(s.end) FROM segments s WHERE s.transcription_id = t.id)
              FROM transcriptions t WHERE t.id IN ({ids})
        """).fetchall()
        return {tid: {"title": search_index.shown_title(title, audio_file), "created_at": created_at or "",
                      "duration_sec": duration or 0.0}
                for tid, title, audio_file, created_at, duration in rows}

    def _speakers(self, words: list[str]) -> list[dict]:
        """Named speakers with a word of their name, or their handle, starting with a query word."""
        if not words:
            return []
        found = []
        for spk_id, labels in self.memory.known_names.items():
            name = labels.get("display")
            if not name:
                continue
            handle = self.memory.get_handle(spk_id)
            candidates = search_index.normalize(name).lower().split() + ([handle.lower()] if handle else [])
            if any(c.startswith(w) for c in candidates for w in words):
                found.append({"id": spk_id, "name": name, "handle": handle})
        found.sort(key=lambda s: s["name"].lower())
        return found[:MAX_SPEAKERS]


def handle_of(speaker: str) -> str:
    """A handle as given, written as @handle in lowercase."""
    return "@" + speaker.strip().lstrip("@").lower()


def _day(which: str, value: str | None) -> str | None:
    if value is None or value == "":
        return None
    try:
        if not _DATE.match(value):
            raise ValueError
        date.fromisoformat(value)
    except ValueError:
        raise SearchRefused(f"The {which} date {value!r} is not a date: write it as YYYY-MM-DD.")
    return value


def _marked_ranges(marked: str) -> list[tuple[int, int]]:
    """Ranges between highlight() markers, as positions in the unmarked text."""
    ranges, pos, start = [], 0, None
    for ch in marked:
        if ch == _HL_START:
            start = pos
        elif ch == _HL_END:
            if start is not None and pos > start:
                ranges.append((start, pos))
            start = None
        else:
            pos += 1
    return ranges


def _snippet(text: str, ranges: list[tuple[int, int]]) -> tuple[str, list[list[int]]]:
    """The text, cut to SNIPPET_WORDS words around the first match if longer,
    with the match ranges moved to match."""
    words = [m.span() for m in _WORD.finditer(text)]
    if len(words) <= SNIPPET_WORDS:
        return text, [[a, b] for a, b in ranges]
    first = next((i for i, (_, end) in enumerate(words) if ranges and end > ranges[0][0]), 0)
    lo = max(0, min(first - WORDS_BEFORE_MATCH, len(words) - SNIPPET_WORDS))
    hi = lo + SNIPPET_WORDS
    begin, finish = words[lo][0], words[hi - 1][1]
    prefix = "… " if lo > 0 else ""
    suffix = " …" if hi < len(words) else ""
    shift = len(prefix) - begin
    moved = [[max(a, begin) + shift, min(b, finish) + shift] for a, b in ranges if b > begin and a < finish]
    return prefix + text[begin:finish] + suffix, moved
