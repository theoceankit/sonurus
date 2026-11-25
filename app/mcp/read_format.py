"""What the MCP read tools answer, as text for an agent: lists of recordings
and speakers, a transcript whole or as contents in parts of about five
minutes, a part of it by time, and search hits. Pure functions over rows and
turns (app/services/transcript_text.py); app/mcp/read_tools.py reads the data.

A transcript is Copy transcript of the editor under a header. Times are
mm:ss or h:mm:ss, dates YYYY-MM-DD as stored (local time).
"""
from __future__ import annotations

from app.mcp.tools import MAX_CHARS, Refused, clock, fit
from app.models.segment import UNASSIGNED
from app.services.transcript_text import Turn, turn_block

CHUNK_SEC = 300          # a part of the contents ends at the first turn this long after its start
LONG_TURN_SEC = 450      # a turn longer than this is cut between its segments
FIRST_PHRASE = 100       # characters of a part's first words in the contents
CUT_ROOM = 160           # room kept for the line that says where a part was cut


def _plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def _day(created_at: str) -> str:
    return created_at[:10] or "unknown date"


def _shown(first: int, count: int, total: int, what: str = "") -> str:
    """"; 51–100 shown" when the list is a part of total, else nothing."""
    return f"; {what}{first + 1}–{first + count} shown" if count < total else ""


# ── Recordings and speakers ───────────────────────────────────────────────────

def recording_line(row: dict) -> str:
    """row: id, title, created_at, duration_sec, handles (named speakers in the
    order they first speak), unknown (how many others), has_note."""
    parts = [f"- recording_id {row['id']}: {row['title']}", _day(row["created_at"]), clock(row["duration_sec"])]
    if row["handles"]:
        parts.append(" ".join(f"@{handle}" for handle in row["handles"]))
    if row["unknown"]:
        parts.append(_plural(row["unknown"], "unknown speaker"))
    if row["has_note"]:
        parts.append("has note")
    return ", ".join(parts)


def format_recordings(rows: list[dict], *, total: int, offset: int, filtered: bool) -> str:
    """A page of recordings, newest first: rows from offset, of total."""
    if not rows:
        if total:
            return f"No recordings from offset {offset}: there are {total}; call list_recordings with offset=0."
        if filtered:
            return "No recordings match: widen the dates or leave out the speaker."
        return "No recordings yet. Transcribe or record audio in Sonorus first."
    if filtered:
        head = f"{total} recording{'s match' if total != 1 else ' matches'}, newest first"
    else:
        head = f"{_plural(total, 'recording')}, newest first"
    lines = [head + _shown(offset, len(rows), total) + ":", *(recording_line(row) for row in rows)]
    if offset + len(rows) < total:
        lines.append(f"More: call list_recordings with offset={offset + len(rows)}.")
    return fit("\n".join(lines))


def format_speakers(rows: list[dict], unnamed: int) -> str:
    """rows: named speakers by name, each name, handle, recordings,
    duration_sec (talk time) and last_seen; unnamed: voices without a name."""
    if rows:
        lines = [f"{_plural(len(rows), 'speaker')} with a name:"]
        for row in rows:
            who = f"- {row['name']}" + (f" @{row['handle']}" if row["handle"] else "")
            if row["recordings"]:
                lines.append(f"{who}: {_plural(row['recordings'], 'recording')}, {clock(row['duration_sec'])} talk time, "
                             f"last {_day(row['last_seen'])}")
            else:
                lines.append(f"{who}: no recordings yet")
    else:
        lines = ["No speaker has a name yet. Name speakers in Sonorus to find recordings by them."]
    if unnamed == 1:
        lines.append("1 voice without a name is not listed: it has a label of its own in each recording "
                     "(Unknown speaker N), and recordings cannot be filtered by it.")
    elif unnamed:
        lines.append(f"{unnamed} voices without a name are not listed: they have a label of their own in each recording "
                     "(Unknown speaker N), and recordings cannot be filtered by them.")
    return fit("\n".join(lines))


# ── Transcript ────────────────────────────────────────────────────────────────

def transcript_header(meta: dict, turns: list[Turn], diarized: bool) -> str:
    """The title; recording_id, date and time, length; the speakers in the order
    they first speak (named ones with their handle), if the recording has any."""
    created = meta["created_at"]
    when = f"{created[:10]} {created[11:16]}".strip() or "unknown date"
    lines = [meta["title"], f"recording_id {meta['id']}, {when}, {clock(meta['duration_sec'])}"]
    if diarized:
        seen: dict[str, str] = {}
        for turn in turns:
            speaker = turn.speaker
            if speaker.id != UNASSIGNED and speaker.id not in seen:
                seen[speaker.id] = speaker.name + (f" @{speaker.handle}" if speaker.handle else "")
        if seen:
            lines.append("Speakers: " + ", ".join(seen.values()))
    return "\n".join(lines)


def _body(turns: list[Turn], diarized: bool) -> str:
    return "\n\n".join(turn_block(turn, diarized) for turn in turns)


def chunks(turns: list[Turn]) -> list[list[Turn]]:
    """The parts of the contents: whole turns, a part ending at the first turn
    that starts CHUNK_SEC or more after the part's start. A turn longer than
    LONG_TURN_SEC (a monologue, a recording without speakers) is first cut
    between its segments into pieces of about CHUNK_SEC."""
    pieces: list[Turn] = []
    for turn in turns:
        if turn.segments[-1].end - turn.segments[0].start <= LONG_TURN_SEC:
            pieces.append(turn)
            continue
        piece = None
        for segment in turn.segments:
            if piece is None or segment.start - piece.start >= CHUNK_SEC:
                piece = Turn(turn.speaker, segment.start, [segment])
                pieces.append(piece)
            else:
                piece.segments.append(segment)
    parts: list[list[Turn]] = []
    for piece in pieces:
        if not parts or piece.start - parts[-1][0].start >= CHUNK_SEC:
            parts.append([piece])
        else:
            parts[-1].append(piece)
    return parts


def _first_phrase(text: str) -> str:
    text = " ".join(text.split())
    if len(text) <= FIRST_PHRASE:
        return text
    cut = text[:FIRST_PHRASE + 1]
    cut = cut[:cut.rfind(" ")] if " " in cut else text[:FIRST_PHRASE]
    return cut.rstrip(" ,;:") + "…"


def contents_line(part: list[Turn], diarized: bool) -> str:
    """- 05:02–10:15, Anna Petrova, Ivan Sidorov (4,812 chars): "First words…\""""
    names: list[str] = []
    for turn in part:
        if turn.speaker.id != UNASSIGNED and turn.speaker.name not in names:
            names.append(turn.speaker.name)
    who = ", " + ", ".join(names) if diarized and names else ""
    span = f"{clock(part[0].start)}–{clock(part[-1].segments[-1].end)}"
    return f'- {span}{who} ({len(_body(part, diarized)):,} chars): "{_first_phrase(part[0].segments[0].text)}"'


def whole_or_contents(meta: dict, turns: list[Turn], diarized: bool, limit: int = MAX_CHARS) -> str:
    """The header and the whole text if it fits in limit; else the header and
    contents by time, with how to read a part."""
    header = transcript_header(meta, turns, diarized)
    body = _body(turns, diarized)
    whole = f"{header}\n\n{body}" if body else header
    if len(whole) <= limit:
        return whole
    parts = chunks(turns)
    start = clock(parts[0][0].start)
    end = clock(parts[1][0].start if len(parts) > 1 else meta["duration_sec"])
    lines = [
        header,
        "",
        f"Too long to return whole ({len(whole):,} chars). Read a part with "
        f'get_transcript(recording_id={meta["id"]}, start="{start}", end="{end}").',
        "",
        "Contents, in parts of about 5 minutes:",
        *(contents_line(part, diarized) for part in parts),
    ]
    return fit("\n".join(lines), limit)


def read_range(meta: dict, turns: list[Turn], diarized: bool, start: float | None, end: float | None,
               limit: int = MAX_CHARS) -> str:
    """The segments that start from start to before end, in whole seconds (a
    segment at 05:02.4 is in a part from 05:02), as turns under the header; a
    turn cut by start repeats its speaker. What does not fit in limit is cut
    before a turn, or between segments if not even one turn fits, with the
    time to read on from. start None: from the start; end None: to the end."""
    duration = meta["duration_sec"]
    if start is not None and end is not None and end <= start:
        raise Refused(f"The end {clock(end)} is not after the start {clock(start)}: give an end after the start.")
    if start and start >= duration:
        raise Refused(f"Recording {meta['id']} is {clock(duration)} long: give a start before {clock(duration)}.")
    low = int(start or 0)
    shown_end = end if end is not None else duration
    head = f"{transcript_header(meta, turns, diarized)}\nPart {clock(low)}–{clock(shown_end)}"

    selected: list[Turn] = []
    for turn in turns:
        segments = [s for s in turn.segments if int(s.start) >= low and (end is None or int(s.start) < end)]
        if segments:
            selected.append(Turn(turn.speaker, segments[0].start, segments))
    if not selected:
        return f"{head}\n\nNo speech starts between {clock(low)} and {clock(shown_end)}."

    budget = limit - CUT_ROOM
    blocks: list[str] = []
    size = len(head)
    for turn in selected:
        block = turn_block(turn, diarized)
        if size + 2 + len(block) <= budget:
            blocks.append(block)
            size += 2 + len(block)
            continue
        resume = turn.segments[0]
        if not blocks:
            # Not even this turn fits: as many of its segments as do.
            kept = 1
            while kept < len(turn.segments) and size + 2 + len(
                    turn_block(Turn(turn.speaker, turn.start, turn.segments[:kept + 1]), diarized)) <= budget:
                kept += 1
            blocks.append(turn_block(Turn(turn.speaker, turn.start, turn.segments[:kept]), diarized))
            if kept == len(turn.segments):
                continue
            resume = turn.segments[kept]
        at = clock(resume.start)
        until = f", end={clock(end)}" if end is not None else ""
        cut = f"Cut at {at}: call get_transcript with start={at}{until} to read on."
        return fit("\n\n".join([head, *blocks, cut]), limit)
    return fit("\n\n".join([head, *blocks]), limit)


# ── Search ────────────────────────────────────────────────────────────────────

def _marked(snippet: str, highlights: list[list[int]]) -> str:
    """The snippet on one line, its matches in **bold**."""
    for start, end in sorted(highlights, reverse=True):
        snippet = f"{snippet[:start]}**{snippet[start:end]}**{snippet[end:]}"
    return " ".join(snippet.split())


def hit_line(hit: dict, labels: dict[str, str]) -> str:
    """A hit as `12:34 Name @handle: …`, `title: …` or `note: …`. labels: the
    labels of the recording's speakers without a name."""
    text = _marked(hit["snippet"], hit["highlights"])
    if hit["kind"] != "segment":
        return f"{hit['kind']}: {text}"
    if hit["speaker_name"]:
        who = hit["speaker_name"] + (f" @{hit['speaker_handle']}" if hit["speaker_handle"] else "")
    elif hit["unassigned"]:
        who = "Unassigned"
    else:
        who = labels.get(hit["speaker_id"] or "", "Unknown speaker")
    return f"{clock(hit['start'] or 0)} {who}: {text}"


def format_search(result: dict, labels: dict[int, dict[str, str]], *, recording_id: int | None,
                  offset: int, limit: int) -> str:
    """result: SearchService.search(). labels: {recording_id: {speaker id: label}}
    for the speakers without a name in the hits. With recording_id, offset
    pages through the hits of that recording; otherwise through recordings."""
    if not result["total_hits"]:
        lines = ["No hits. Try other words, a word's beginning, or OR between words."]
    elif recording_id is not None:
        recording = result["recordings"][0]
        hits = recording["hits"]
        total = recording["hit_count"]
        lines = [
            f"{_plural(total, 'hit')} in recording {recording_id}{_shown(offset, len(hits), total)}:",
            f"recording_id {recording_id}: {recording['title']}, {_day(recording['created_at'])}",
            *(f"  {hit_line(hit, labels.get(recording_id, {}))}" for hit in hits),
        ]
    else:
        recordings = result["recordings"]
        total = result["total_recordings"]
        lines = [f"{_plural(result['total_hits'], 'hit')} in {_plural(total, 'recording')}, newest first"
                 f"{_shown(offset, len(recordings), total, 'recordings ')}:"]
        for recording in recordings:
            rid = recording["recording_id"]
            lines += ["", f"recording_id {rid}: {recording['title']}, {_day(recording['created_at'])} "
                          f"({_plural(recording['hit_count'], 'hit')})"]
            lines += [f"  {hit_line(hit, labels.get(rid, {}))}" for hit in recording["hits"]]
            more = recording["hit_count"] - len(recording["hits"])
            if more > 0:
                lines.append(f"  {more} more: call search with recording_id={rid}.")

    if result["speakers"]:
        names = ", ".join(s["name"] + (f" @{s['handle']}" if s["handle"] else "") for s in result["speakers"])
        first = next((s["handle"] for s in result["speakers"] if s["handle"]), None)
        hint = f' To search what one said, give speaker="@{first}".' if first else ""
        lines += ["", f"Speakers whose name or handle matches: {names}.{hint}"]

    if result["total_hits"]:
        if recording_id is not None:
            shown = len(result["recordings"][0]["hits"])
            if offset + shown < result["recordings"][0]["hit_count"]:
                lines += ["", f"More hits: call search with recording_id={recording_id} and offset={offset + shown}."]
        elif offset + len(result["recordings"]) < result["total_recordings"]:
            lines += ["", f"More recordings: call search with offset={offset + len(result['recordings'])}."]
    return fit("\n".join(lines))
