import json
import os
import sqlite3
from datetime import datetime, date, timedelta

from app.models.transcript import Transcript
from app.models.segment import Segment, UNASSIGNED
from app.logger import get_logger
from app.db import search_index
from app.db.schema import init_db
from app.db.serializers import serialize_embedding, deserialize_embedding

log = get_logger("DB")


class TranscriptStorageService:
    def __init__(self, db_path="speaker_memory.db"):
        self.db_path = db_path
        self._init_db()

    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_db(self):
        with self._connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            init_db(conn)

    # ── Write ─────────────────────────────────────────────────────────────────

    def save(self, transcript: Transcript) -> int:
        """Insert transcript + segments, set transcript.db_id. Returns new id."""
        with self._connect() as conn:
            cursor = conn.execute(
                "INSERT INTO transcriptions (audio_file, language, status, created_at, title, diarized) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (transcript.audio_path, transcript.language,
                 transcript.status, datetime.now().isoformat(), transcript.title, int(transcript.diarized)),
            )
            db_id = cursor.lastrowid

            conn.executemany(
                """INSERT INTO segments
                       (transcription_id, speaker_id, start, end, text, speaker_raw, embedding, unassigned)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    (
                        db_id,
                        None if seg.unassigned else (seg.speaker_final or seg.speaker_resolved),
                        seg.start, seg.end, seg.text, seg.speaker_raw,
                        serialize_embedding(seg.embedding),
                        int(seg.unassigned),
                    )
                    for seg in transcript.segments
                ],
            )
            conn.executemany(
                "INSERT INTO speaker_matches (transcription_id, speaker_id, score) VALUES (?, ?, ?)",
                [(db_id, spk_id, float(score)) for spk_id, score in transcript.match_scores.items()],
            )
            search_index.index_title(conn, db_id, transcript.title, transcript.audio_path)

        log.info(f"INSERT transcriptions id={db_id} audio={transcript.audio_path}")
        log.info(f"INSERT segments {len(transcript.segments)} rows for transcription {db_id}")
        transcript.db_id = db_id
        return db_id

    def set_segments_speaker(self, db_id: int, ranges: list[tuple[float, float]], speaker_id: str) -> None:
        """Give segments, identified by their time ranges, one speaker in one transaction.
        speaker_id may be UNASSIGNED, which is a flag and never a stored id."""
        stored_id, unassigned = (None, 1) if speaker_id == UNASSIGNED else (speaker_id, 0)
        with self._connect() as conn:
            conn.executemany(
                "UPDATE segments SET speaker_id = ?, unassigned = ? "
                "WHERE transcription_id = ? AND start = ? AND end = ?",
                [(stored_id, unassigned, db_id, start, end) for start, end in ranges],
            )
        log.info(f"UPDATE segments speaker_id={speaker_id} for {len(ranges)} segments of transcription={db_id}")

    def update_title(self, db_id: int, title: str) -> bool:
        """Set the transcript title. Returns False if the transcript does not exist."""
        with self._connect() as conn:
            updated = conn.execute(
                "UPDATE transcriptions SET title = ? WHERE id = ?", (title, db_id)
            ).rowcount
            if updated:
                (audio_file,) = conn.execute(
                    "SELECT audio_file FROM transcriptions WHERE id = ?", (db_id,)
                ).fetchone()
                search_index.index_title(conn, db_id, title, audio_file)
        if updated:
            log.info(f"UPDATE transcriptions title for id={db_id}")
        return bool(updated)

    def mark_opened(self, db_id: int) -> bool:
        """Mark the transcript as opened by the user. Returns False if it does not exist."""
        with self._connect() as conn:
            updated = conn.execute(
                "UPDATE transcriptions SET opened = 1 WHERE id = ?", (db_id,)
            ).rowcount
        return bool(updated)

    def mark_unopened(self, db_id: int) -> bool:
        """Mark the transcript as not opened yet, as the user asked. Returns False if it does not exist."""
        with self._connect() as conn:
            updated = conn.execute(
                "UPDATE transcriptions SET opened = 0 WHERE id = ?", (db_id,)
            ).rowcount
        return bool(updated)

    def update_segment_text(self, db_id: int, start: float, end: float, new_text: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE segments SET text = ? WHERE transcription_id = ? AND start = ? AND end = ?",
                (new_text, db_id, start, end)
            )
        log.info(f"Updated segment text for transcription {db_id}")

    def delete_segment(self, db_id: int, start: float, end: float) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM segments WHERE transcription_id = ? AND start = ? AND end = ?",
                (db_id, start, end)
            )
        log.info(f"Deleted segment from transcription {db_id}")

    def delete(self, db_id: int) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM segments WHERE transcription_id = ?", (db_id,))
            conn.execute("DELETE FROM speaker_matches WHERE transcription_id = ?", (db_id,))
            conn.execute("DELETE FROM notes WHERE transcription_id = ?", (db_id,))
            conn.execute("DELETE FROM transcriptions WHERE id = ?", (db_id,))
            conn.execute("DELETE FROM search_titles WHERE rowid = ?", (db_id,))
            search_index.index_note(conn, db_id, None)
        log.info(f"DELETE transcription id={db_id} and its segments")

    # ── Notes ─────────────────────────────────────────────────────────────────

    def exists(self, db_id: int) -> bool:
        with self._connect() as conn:
            return conn.execute("SELECT 1 FROM transcriptions WHERE id = ?", (db_id,)).fetchone() is not None

    def get_note(self, db_id: int) -> dict | None:
        """The note of a transcript as {content, updated_at}, or None without one."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT content, updated_at FROM notes WHERE transcription_id = ?", (db_id,)
            ).fetchone()
        if row is None:
            return None
        return {"content": json.loads(row[0]), "updated_at": row[1]}

    def save_note(self, db_id: int, content: dict) -> bool:
        """Store the note of a transcript, replacing the one it had. Returns False
        if the transcript does not exist."""
        now = datetime.now().isoformat()
        with self._connect() as conn:
            if conn.execute("SELECT 1 FROM transcriptions WHERE id = ?", (db_id,)).fetchone() is None:
                return False
            conn.execute(
                """INSERT INTO notes (transcription_id, content, created_at, updated_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(transcription_id) DO UPDATE
                   SET content = excluded.content, updated_at = excluded.updated_at""",
                (db_id, json.dumps(content, ensure_ascii=False), now, now),
            )
            search_index.index_note(conn, db_id, content)
        return True

    def delete_note(self, db_id: int) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM notes WHERE transcription_id = ?", (db_id,))
            search_index.index_note(conn, db_id, None)

    def rewrite_note_mentions(self, speaker_id: str, into_id: str | None = None, name: str | None = None) -> int:
        """Make the notes follow a speaker who is gone. With into_id (a merge) every
        mention of speaker_id mentions into_id; without it (a deletion) each becomes
        plain text: name, or the label the mention kept. Notes that do not mention
        the speaker are not written. Returns the number of notes rewritten."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, transcription_id, content FROM notes WHERE instr(content, ?) > 0", (speaker_id,)
            ).fetchall()
            rewritten = 0
            for note_id, tid, content in rows:
                doc = json.loads(content)
                new_doc, changed = _rewrite_mentions(doc, speaker_id, into_id, name)
                if not changed:
                    continue
                conn.execute(
                    "UPDATE notes SET content = ? WHERE id = ?",
                    (json.dumps(new_doc, ensure_ascii=False), note_id),
                )
                if tid is not None:
                    search_index.index_note(conn, tid, new_doc)
                rewritten += 1
        if rewritten:
            log.info(f"UPDATE notes mentions of {speaker_id} → {into_id or 'text'}: {rewritten} notes")
        return rewritten

    def reindex_notes_mentioning(self, speaker_id: str) -> None:
        """Index again the notes that mention a speaker, after their name changed:
        a mention is found by the name the speaker has now."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT transcription_id, content FROM notes "
                "WHERE transcription_id IS NOT NULL AND instr(content, ?) > 0",
                (speaker_id,),
            ).fetchall()
            if not rows:
                return
            names = search_index.speaker_names(conn)
            for tid, content in rows:
                search_index.index_note(conn, tid, content, names)

    def unassign_speaker(self, speaker_id: str) -> dict:
        """Detach every segment of a deleted speaker: speaker_id becomes NULL and
        the segment is flagged unassigned. Returns affected segment/transcript counts."""
        with self._connect() as conn:
            segments, transcripts = conn.execute(
                "SELECT COUNT(*), COUNT(DISTINCT transcription_id) FROM segments WHERE speaker_id = ?",
                (speaker_id,),
            ).fetchone()
            conn.execute(
                "UPDATE segments SET speaker_id = NULL, unassigned = 1 WHERE speaker_id = ?",
                (speaker_id,),
            )
            conn.execute("DELETE FROM speaker_matches WHERE speaker_id = ?", (speaker_id,))
        log.info(f"UPDATE segments unassigned speaker={speaker_id}: {segments} rows in {transcripts} transcriptions")
        return {"segments": segments, "transcripts": transcripts}

    def move_speaker(self, from_id: str, to_id: str) -> dict:
        """Give every segment of from_id to to_id, in every transcript, with its
        possible matches: where both were matched in one transcript, one row stays,
        with the higher score, confirmed if either was. Returns the moved
        {segments, transcripts} counts."""
        with self._connect() as conn:
            segments, transcripts = conn.execute(
                "SELECT COUNT(*), COUNT(DISTINCT transcription_id) FROM segments WHERE speaker_id = ?",
                (from_id,),
            ).fetchone()
            conn.execute("UPDATE segments SET speaker_id = ? WHERE speaker_id = ?", (to_id, from_id))
            conn.execute(
                "INSERT INTO speaker_matches (transcription_id, speaker_id, score, confirmed) "
                "SELECT transcription_id, ?, score, confirmed FROM speaker_matches WHERE speaker_id = ? "
                "ON CONFLICT(transcription_id, speaker_id) DO UPDATE SET "
                "score = MAX(score, excluded.score), confirmed = MAX(confirmed, excluded.confirmed)",
                (to_id, from_id),
            )
            conn.execute("DELETE FROM speaker_matches WHERE speaker_id = ?", (from_id,))
        log.info(f"UPDATE segments speaker={from_id} → {to_id}: {segments} rows in {transcripts} transcriptions")
        return {"segments": segments, "transcripts": transcripts}

    def set_match_confirmed(self, db_id: int, speaker_id: str, confirmed: bool) -> bool:
        """Mark a recognized speaker as confirmed by the user in this transcript,
        or take it back. False when the speaker was not recognized there."""
        with self._connect() as conn:
            cursor = conn.execute(
                "UPDATE speaker_matches SET confirmed = ? WHERE transcription_id = ? AND speaker_id = ?",
                (int(confirmed), db_id, speaker_id),
            )
        return cursor.rowcount > 0

    def count_by_audio_file(self, audio_file: str) -> int:
        """Number of transcriptions that reference audio_file."""
        with self._connect() as conn:
            return conn.execute(
                "SELECT COUNT(*) FROM transcriptions WHERE audio_file = ?", (audio_file,)
            ).fetchone()[0]

    def audio_files(self) -> set[str]:
        """Every audio path referenced by a transcript."""
        with self._connect() as conn:
            return {r[0] for r in conn.execute("SELECT DISTINCT audio_file FROM transcriptions")}

    def clear(self) -> int:
        """Delete every transcription and segment. Returns the number of transcriptions removed."""
        with self._connect() as conn:
            count = conn.execute("SELECT COUNT(*) FROM transcriptions").fetchone()[0]
            conn.execute("DELETE FROM segments")
            conn.execute("DELETE FROM speaker_matches")
            conn.execute("DELETE FROM notes")
            conn.execute("DELETE FROM transcriptions")
            search_index.clear(conn)
        log.info(f"DELETE all transcriptions ({count}) and their segments")
        return count

    # ── Read ──────────────────────────────────────────────────────────────────

    def load(self, db_id: int, with_embeddings: bool = True) -> Transcript:
        """Load a Transcript from DB by id.

        with_embeddings=False skips reading and deserialising the embedding
        BLOBs — for callers that only need text/timing/speakers.
        """
        with self._connect() as conn:
            row = conn.execute(
                "SELECT audio_file, language, status, title, diarized FROM transcriptions WHERE id = ?",
                (db_id,),
            ).fetchone()

            if not row:
                raise ValueError(f"Transcription {db_id} not found")

            audio_file, language, status, title_db, diarized = row
            log.info(f"SELECT transcriptions id={db_id}")

            emb_col = "embedding" if with_embeddings else "NULL"
            seg_rows = conn.execute(
                f"""SELECT start, end, text, speaker_raw, speaker_id, {emb_col}, unassigned
                   FROM segments
                   WHERE transcription_id = ?
                   ORDER BY start""",
                (db_id,),
            ).fetchall()

        log.info(f"SELECT segments {len(seg_rows)} rows for transcription {db_id}")
        segments = [
            Segment(
                start=r[0], end=r[1], text=r[2],
                speaker_raw=r[3] or "",
                speaker_resolved=r[4],
                embedding=deserialize_embedding(r[5]),
                unassigned=bool(r[6]),
            )
            for r in seg_rows
        ]

        return Transcript(
            segments=segments,
            audio_path=audio_file,
            language=language or "",
            status=status or "draft",
            title=title_db,
            diarized=bool(diarized),
            db_id=db_id,
        )

    def speaker_matches(self, db_id: int) -> dict[str, dict]:
        """{speaker id: {score, confirmed}} of the speakers recognized from memory
        when the transcript was made."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT speaker_id, score, confirmed FROM speaker_matches WHERE transcription_id = ?",
                (db_id,),
            ).fetchall()
        return {spk_id: {"score": score, "confirmed": bool(confirmed)} for spk_id, score, confirmed in rows}

    def matches_of_speaker(self, speaker_id: str) -> dict[int, dict]:
        """{transcription id: {score, confirmed}} of every transcript where
        speaker_id was recognized from memory."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT transcription_id, score, confirmed FROM speaker_matches WHERE speaker_id = ?",
                (speaker_id,),
            ).fetchall()
        return {tid: {"score": score, "confirmed": bool(confirmed)} for tid, score, confirmed in rows}

    def list_all(self) -> list[dict]:
        """Return recording metadata for sidebar, newest first."""
        with self._connect() as conn:
            rows = conn.execute(
                """SELECT t.id,
                          t.audio_file,
                          t.title,
                          t.created_at,
                          t.status,
                          t.opened,
                          MAX(s.end)                         AS duration_sec,
                          GROUP_CONCAT(DISTINCT s.speaker_id) AS speaker_ids,
                          EXISTS (SELECT 1 FROM notes n WHERE n.transcription_id = t.id) AS has_note
                   FROM transcriptions t
                   LEFT JOIN segments s ON s.transcription_id = t.id
                   GROUP BY t.id
                   ORDER BY t.created_at DESC""",
            ).fetchall()

        today     = date.today()
        yesterday = today - timedelta(days=1)
        last_week = today - timedelta(days=7)

        records = []
        for r in rows:
            db_id, audio_file, title_db, created_at_str, status, opened, duration_sec, speaker_ids_str, has_note = r

            created = date.fromisoformat(created_at_str[:10]) if created_at_str else today
            if created == today:
                section = "Today"
            elif created == yesterday:
                section = "Yesterday"
            elif created >= last_week:
                section = "Last week"
            else:
                section = created.strftime("%b %d, %Y")

            speaker_ids = [s for s in (speaker_ids_str or "").split(",") if s]
            duration_str = _fmt_duration(duration_sec or 0)
            title = title_db or os.path.splitext(os.path.basename(audio_file))[0]

            records.append({
                "id":         db_id,
                "title":      title,
                "created_at": created_at_str or "",
                "section":    section,
                "status":     status,
                "opened":     bool(opened),
                "has_note":   bool(has_note),
                "duration":   duration_str,
                "duration_sec": duration_sec or 0,
                "speakers":   speaker_ids,
            })

        return records

    def speaker_stats(self) -> dict[str, dict]:
        """Per-speaker usage across all transcripts:
        {speaker_id: {segments, transcripts, duration_sec, last_seen}}.
        Unassigned and raw-label segments (speaker_id NULL) are not counted."""
        with self._connect() as conn:
            rows = conn.execute(
                """SELECT s.speaker_id,
                          COUNT(*),
                          COUNT(DISTINCT s.transcription_id),
                          SUM(s.end - s.start),
                          MAX(t.created_at)
                   FROM segments s
                   JOIN transcriptions t ON t.id = s.transcription_id
                   WHERE s.speaker_id IS NOT NULL
                   GROUP BY s.speaker_id""",
            ).fetchall()
        return {
            spk_id: {
                "segments": segments,
                "transcripts": transcripts,
                "duration_sec": duration or 0.0,
                "last_seen": last_seen or "",
            }
            for spk_id, segments, transcripts, duration, last_seen in rows
        }

    def transcripts_for_speaker(self, speaker_id: str) -> list[dict]:
        """Transcripts in which speaker_id speaks, newest first."""
        with self._connect() as conn:
            rows = conn.execute(
                """SELECT t.id, t.title, t.audio_file, t.created_at,
                          COUNT(*), SUM(s.end - s.start)
                   FROM segments s
                   JOIN transcriptions t ON t.id = s.transcription_id
                   WHERE s.speaker_id = ?
                   GROUP BY t.id
                   ORDER BY t.created_at DESC""",
                (speaker_id,),
            ).fetchall()
        return [
            {
                "id": db_id,
                "title": title or os.path.splitext(os.path.basename(audio_file))[0],
                "audio_file": audio_file,
                "created_at": created_at or "",
                "segments": segments,
                "duration_sec": duration or 0.0,
            }
            for db_id, title, audio_file, created_at, segments, duration in rows
        ]

    def speaker_segments(self, speaker_id: str, transcript_id: int | None = None) -> list[dict]:
        """Segments of speaker_id with their transcript's audio file and embedding
        (optionally within one transcript) — candidates for a voice sample."""
        query = (
            "SELECT s.transcription_id, t.audio_file, s.start, s.end, s.text, s.embedding "
            "FROM segments s JOIN transcriptions t ON t.id = s.transcription_id "
            "WHERE s.speaker_id = ?"
        )
        params: tuple = (speaker_id,)
        if transcript_id is not None:
            query += " AND s.transcription_id = ?"
            params += (transcript_id,)
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [
            {"transcription_id": tid, "audio_file": audio, "start": start, "end": end,
             "text": text, "embedding": deserialize_embedding(blob)}
            for tid, audio, start, end, text, blob in rows
        ]

    def get_embeddings_grouped_by_transcript(
        self, speaker_id: str, with_durations: bool = False, transcript_id: int | None = None,
    ) -> dict:
        """Return {transcription_id: [embeddings]} of the diarization turns the
        speaker owns, with with_durations {transcription_id: [(embedding, turn
        duration)]}; optionally within one transcript.

        Every sentence of a turn carries the turn's embedding, so the sentences
        of a transcript with the same embedding are one turn. A turn belongs to
        whoever holds more than half of its sentences' duration (unassigned
        sentences hold their share too, a tie belongs to nobody) and appears
        once, with the duration of all its sentences. A sentence moved to
        another speaker therefore does not take the voice of the person who
        said the rest of the turn.

        Used by CommitService to give each recording equal weight when averaging,
        regardless of how many segments it contains.
        """
        query = (
            "SELECT transcription_id, embedding, start, \"end\", "
            "CASE WHEN unassigned THEN NULL ELSE speaker_id END FROM segments "
            "WHERE embedding IS NOT NULL AND transcription_id IN "
            "(SELECT transcription_id FROM segments WHERE speaker_id = ?)"
        )
        params: tuple = (speaker_id,)
        if transcript_id is not None:
            query += " AND transcription_id = ?"
            params += (transcript_id,)
        with self._connect() as conn:
            rows = conn.execute(query + " ORDER BY transcription_id, start", params).fetchall()
        # (transcription_id, embedding blob) → {holder: seconds}, in order of first sentence
        turns: dict[tuple[int, bytes], dict] = {}
        for tid, blob, start, end, holder in rows:
            held = turns.setdefault((tid, blob), {})
            held[holder] = held.get(holder, 0.0) + max(0.0, end - start)
        grouped: dict[int, list] = {}
        for (tid, blob), held in turns.items():
            total = sum(held.values())
            mine = held.get(speaker_id, 0.0)
            if not (mine > total / 2 or (total == 0 and set(held) == {speaker_id})):
                continue
            emb = deserialize_embedding(blob)
            grouped.setdefault(tid, []).append((emb, total) if with_durations else emb)
        return grouped


def _fmt_duration(seconds: float) -> str:
    mins = int(seconds) // 60
    return f"{mins} min" if mins < 60 else f"{mins // 60}h {mins % 60}m"


def _rewrite_mentions(node: dict, speaker_id: str, into_id: str | None, name: str | None) -> tuple[dict, bool]:
    """A copy of a note's node with every mention of speaker_id given to into_id, or
    replaced by its name as text when into_id is None. Returns (node, changed)."""
    children = node.get("content")
    if not isinstance(children, list):
        return node, False
    changed = False
    content = []
    for child in children:
        attrs = (child.get("attrs") or {}) if isinstance(child, dict) else {}
        if isinstance(child, dict) and child.get("type") == "mention" \
                and attrs.get("kind", "speaker") == "speaker" and attrs.get("id") == speaker_id:
            changed = True
            if into_id is not None:
                content.append({**child, "attrs": {**attrs, "id": into_id}})
            else:
                text = name or attrs.get("label") or ""
                if text:
                    marks = {"marks": child["marks"]} if child.get("marks") else {}
                    content.append({"type": "text", "text": text, **marks})
            continue
        if isinstance(child, dict):
            child, inner = _rewrite_mentions(child, speaker_id, into_id, name)
            changed = changed or inner
        content.append(child)
    return ({**node, "content": content}, True) if changed else (node, False)
