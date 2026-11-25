"""The MCP tools that read recordings: list_recordings, list_speakers,
get_transcript and search. They read through the services of the REST API and
answer with app/mcp/read_format.py; speakers are named by @handle, never by id.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Annotated

from mcp.server.mcpserver import MCPServer
from mcp_types import CallToolResult, TextContent
from pydantic import Field

from app.mcp.read_format import format_recordings, format_search, format_speakers, read_range, whole_or_contents
from app.mcp.tools import Refused, parse_clock
from app.services.note_markdown import NoteSpeaker
from app.services.search_query import SearchQueryError
from app.services.search_service import RecordingNotFound, SearchRefused, SearchService, handle_of
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.transcript_text import build_turns, effective_speaker, unknown_speaker_names

RecordingId = Annotated[int, Field(description="The recording, by its recording_id from list_recordings.")]
Speaker = Annotated[str | None, Field(description="A named speaker's @handle, from list_speakers.")]
DateFrom = Annotated[str | None, Field(description="First day, YYYY-MM-DD, local time.")]
DateTo = Annotated[str | None, Field(description="Last day, YYYY-MM-DD, local time; included.")]
Time = Annotated[str | float | None, Field(description="A time in the recording: mm:ss, h:mm:ss or seconds.")]
Offset = Annotated[int, Field(ge=0, description="How many to skip, to read the next page.")]


def _answer(text: str, error: bool = False) -> CallToolResult:
    # Returned, not raised as ToolError: the SDK would put "Error executing tool
    # <name>:" before the line.
    return CallToolResult(content=[TextContent(type="text", text=text)], is_error=error)


def _not_found(recording_id: int) -> Refused:
    return Refused(f"Recording {recording_id} not found: use list_recordings to see recording_ids.")


def _check_handle(search: SearchService, speaker: str | None) -> None:
    if speaker and search.speaker_id(speaker) is None:
        raise Refused(f"No speaker has the handle {handle_of(speaker)}: "
                      "use the handle of a named speaker (list_speakers).")


def _speakers_of(memory: SpeakerMemoryService, ids) -> list[NoteSpeaker]:
    return [NoteSpeaker(id=spk_id, name=memory.get_name(spk_id), handle=memory.get_handle(spk_id)) for spk_id in ids]


def recordings(storage, memory, search, speaker=None, date_from=None, date_to=None, limit=50, offset=0) -> str:
    _check_handle(search, speaker)
    try:
        speaker_id, day_from, day_to = search.filters(speaker or None, date_from or None, date_to or None)
    except SearchRefused as refusal:
        raise Refused(str(refusal))
    speakers_of = storage.recording_speakers()
    matched = []
    for row in storage.list_all():
        ids = speakers_of.get(row["id"], [])
        day = row["created_at"][:10]
        if speaker_id and speaker_id not in ids:
            continue
        if (day_from and day < day_from) or (day_to and day > day_to):
            continue
        named = [spk_id for spk_id in ids if memory.get_name(spk_id)]
        matched.append({**row, "handles": [memory.get_handle(spk_id) for spk_id in named],
                        "unknown": len(ids) - len(named)})
    return format_recordings(matched[offset:offset + limit], total=len(matched), offset=offset,
                             filtered=bool(speaker or date_from or date_to))


def speakers(storage, memory) -> str:
    stats = storage.speaker_stats()
    rows, unnamed = [], 0
    for spk_id in memory.speaker_ids() | set(stats):
        name = memory.get_name(spk_id)
        if not name:
            unnamed += 1
            continue
        stat = stats.get(spk_id, {})
        rows.append({"name": name, "handle": memory.get_handle(spk_id), "recordings": stat.get("transcripts", 0),
                     "duration_sec": stat.get("duration_sec", 0.0), "last_seen": stat.get("last_seen", "")})
    rows.sort(key=lambda row: (row["name"].strip().casefold(), row["handle"] or ""))
    return format_speakers(rows, unnamed)


def transcript(storage, memory, recording_id: int, start=None, end=None) -> str:
    meta = storage.recording_meta(recording_id)
    if meta is None:
        raise _not_found(recording_id)
    low = parse_clock(start) if start not in (None, "") else None
    high = parse_clock(end) if end not in (None, "") else None
    loaded = storage.load(recording_id, with_embeddings=False)
    ids = dict.fromkeys(effective_speaker(segment) for segment in loaded.segments)
    turns = build_turns(loaded.segments, _speakers_of(memory, ids))
    if low is None and high is None:
        return whole_or_contents(meta, turns, loaded.diarized)
    return read_range(meta, turns, loaded.diarized, low, high)


def found(storage, memory, search, query, speaker=None, date_from=None, date_to=None, recording_id=None,
          limit=10, offset=0) -> str:
    _check_handle(search, speaker)
    try:
        result = search.search(query, speaker=speaker or None, date_from=date_from or None, date_to=date_to or None,
                               recording_id=recording_id, limit=limit, offset=offset,
                               hits_per_recording=20 if recording_id is not None else 3)
    except (SearchQueryError, SearchRefused) as refusal:
        raise Refused(str(refusal))
    except RecordingNotFound:
        raise _not_found(recording_id)
    labels = {}
    for recording in result["recordings"]:
        if any(hit["kind"] == "segment" and hit["speaker_id"] and not hit["speaker_name"] for hit in recording["hits"]):
            segments = storage.load(recording["recording_id"], with_embeddings=False).segments
            named = {spk_id for spk_id in dict.fromkeys(map(effective_speaker, segments)) if memory.get_name(spk_id)}
            labels[recording["recording_id"]] = unknown_speaker_names(segments, named)
    return format_search(result, labels, recording_id=recording_id, offset=offset, limit=limit)


def register_read_tools(server: MCPServer, storage: Callable[[], TranscriptStorageService],
                        memory: Callable[[], SpeakerMemoryService], search: Callable[[], SearchService]) -> None:
    """The read tools; storage, memory and search give the services each call uses."""
    search_service = search   # the name search is the tool's below

    def run(read: Callable[[], str]) -> CallToolResult:
        try:
            return _answer(read())
        except Refused as refusal:
            return _answer(str(refusal), error=True)

    @server.tool()
    def list_recordings(speaker: Speaker = None, date_from: DateFrom = None, date_to: DateTo = None,
                        limit: Annotated[int, Field(ge=1, le=200, description="Recordings per page.")] = 50,
                        offset: Offset = 0) -> CallToolResult:
        """List the user's recordings in Sonorus, newest first: recording_id, title, date (YYYY-MM-DD), length,
        named speakers by @handle, how many unknown speakers, and whether it has a note. Filter by a named
        speaker and by dates."""
        return run(lambda: recordings(storage(), memory(), search_service(), speaker, date_from, date_to, limit, offset))

    @server.tool()
    def list_speakers() -> CallToolResult:
        """List the speakers with a name, by name: @handle, in how many recordings they speak, their talk time
        and the date they last spoke. Use the @handle to filter list_recordings and search. Speakers without a
        name are only counted: in a transcript each has a label of its own recording (Unknown speaker N)."""
        return run(lambda: speakers(storage(), memory()))

    @server.tool()
    def get_transcript(recording_id: RecordingId, start: Time = None, end: Time = None) -> CallToolResult:
        """Read the transcript of a recording as the user copies it from Sonorus: a header (title, recording_id,
        date, length, speakers), then each turn as "Name mm:ss" over its text. Without start and end: the whole
        transcript, or, when it is too long, contents in parts of about 5 minutes. With start and/or end: the
        segments that start in [start, end); a part too long is cut at a turn and says where to read on."""
        return run(lambda: transcript(storage(), memory(), recording_id, start, end))

    @server.tool()
    def search(query: Annotated[str, Field(description="What to find; see the tool's description.")],
               speaker: Speaker = None, date_from: DateFrom = None, date_to: DateTo = None,
               recording_id: Annotated[int | None, Field(description="Only this recording; offset then pages its hits.")] = None,
               limit: Annotated[int, Field(ge=1, le=50, description="Recordings per page.")] = 10,
               offset: Offset = 0) -> CallToolResult:
        """Search the recordings' transcripts, titles and notes; newest recordings first, up to 3 hits each with
        the time and speaker of a hit, matches in **bold**. Read around a hit with get_transcript and a start a
        little before its time. Query: words match by their beginning (releas finds release, released);
        "a phrase" in double quotes matches word for word; AND (the default between words), OR and NOT in
        capitals, and parentheses, e.g. (budget OR price) NOT draft. Case and ё/е do not matter."""
        return run(lambda: found(storage(), memory(), search_service(), query, speaker, date_from, date_to,
                                 recording_id, limit, offset))
