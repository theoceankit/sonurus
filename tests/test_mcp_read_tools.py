"""The MCP tools that read recordings: list_recordings, list_speakers,
get_transcript and search. What they answer is pure and tested on its own
(test_mcp_read_format.py); here the tools are called by the SDK's client
against a temporary database, as in test_mcp_server.py."""
import re

import httpx2
import pytest
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from app.api.dependencies import get_app_settings, get_memory_service, get_storage_service
from app.api.main import app, mcp_endpoint
from app.mcp.tools import MAX_CHARS
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.app_settings import MCP_ENABLED
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService

URL = "http://127.0.0.1:8000/mcp"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
VOICE = "7d3c2b1a-0f9e-4d8c-b7a6-959483726150"   # a voice of the base without a name
READ_TOOLS = {"list_recordings", "list_speakers", "get_transcript", "search"}


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def services(tmp_path):
    db = str(tmp_path / "data.db")
    storage = TranscriptStorageService(db_path=db)
    memory = SpeakerMemoryService(db_path=db)
    app.dependency_overrides[get_storage_service] = lambda: storage
    app.dependency_overrides[get_memory_service] = lambda: memory
    app.dependency_overrides[get_app_settings]().set_bool(MCP_ENABLED, True)
    yield storage, memory
    app.dependency_overrides.pop(get_storage_service, None)
    app.dependency_overrides.pop(get_memory_service, None)


ANSWERS: list[str] = []


async def _session(calls):
    async with mcp_endpoint.running(), httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="http://127.0.0.1:8000"
    ) as http:
        async with Client(streamable_http_client(URL, http_client=http)) as client:
            return [await client.call_tool(name, arguments) for name, arguments in calls]


async def _call(name, arguments=None):
    result = (await _session([(name, arguments or {})]))[0]
    text = "".join(part.text for part in result.content)
    # Every answer: within the limit and without a speaker's UUID.
    assert len(text) <= MAX_CHARS, f"{name} answered {len(text)} characters"
    assert not UUID.search(text), f"{name} gave out a UUID: {UUID.search(text).group()}"
    return result, text


async def _error(name, arguments):
    result, text = await _call(name, arguments)
    assert result.is_error
    assert "\n" not in text
    assert not text.startswith("Error executing tool")
    return text


async def _ok(name, arguments=None):
    result, text = await _call(name, arguments)
    assert not result.is_error, text
    return text


def _recording(storage, title, created_at, segments, diarized=True):
    db_id = storage.save(Transcript(audio_path=f"recordings/{title}.wav", language="en", segments=segments,
                                    diarized=diarized))
    storage.update_title(db_id, title)
    with storage._connect() as conn:
        conn.execute("UPDATE transcriptions SET created_at = ? WHERE id = ?", (created_at, db_id))
    return db_id


def _seg(start, speaker=None, text="Hello there.", raw="SPEAKER_00", length=5.0, unassigned=False):
    return Segment(start, start + length, text, raw, speaker_resolved=speaker, unassigned=unassigned)


@pytest.fixture
def base(services):
    """Anna and Ivan with names; three recordings in November."""
    storage, memory = services
    anna = memory.create_named_speaker("Anna Petrova", handle="anna")
    ivan = memory.create_named_speaker("Ivan Sidorov", handle="ivan")
    sync = _recording(storage, "Weekly sync", "2026-11-20T14:05:00", [
        _seg(0, anna, "Good morning, we ship the release on Friday."),
        _seg(9.4, ivan, "The build is green."),
        _seg(20, VOICE, "Who is driving the release notes?", raw="SPEAKER_02"),
        _seg(30, None, "A voice diarization found and memory did not.", raw="SPEAKER_03"),
        _seg(40, anna, "I am.", length=2),
    ])
    interview = _recording(storage, "Interview", "2026-11-02T09:00:00", [
        _seg(0, ivan, "Tell me about the release process."),
        _seg(10, None, "Gone speaker.", unassigned=True),
    ])
    lecture = _recording(storage, "Lecture", "2026-10-15T18:00:00", [
        _seg(0, None, "A recording without speakers."), _seg(5, None, "Second paragraph."),
    ], diarized=False)
    storage.save_note(sync, {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Release checklist"}]}]})
    return {"storage": storage, "memory": memory, "anna": anna, "ivan": ivan,
            "sync": sync, "interview": interview, "lecture": lecture}


# ── The tools ─────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_the_read_tools_are_listed_with_their_parameters(services):
    async with mcp_endpoint.running(), httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="http://127.0.0.1:8000"
    ) as http:
        async with Client(streamable_http_client(URL, http_client=http)) as client:
            tools = {tool.name: tool for tool in (await client.list_tools()).tools}
    assert READ_TOOLS <= set(tools)
    assert tools["get_transcript"].input_schema["required"] == ["recording_id"]
    assert tools["search"].input_schema["required"] == ["query"]
    assert not tools["list_recordings"].input_schema.get("required")
    assert not tools["list_speakers"].input_schema.get("required")
    for name in READ_TOOLS:
        assert tools[name].description
    assert "OR" in tools["search"].description and '"' in tools["search"].description


# ── list_recordings ───────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_list_recordings_gives_ids_speakers_and_notes(base):
    text = await _ok("list_recordings")
    assert text == (
        "3 recordings, newest first:\n"
        f"- recording_id {base['sync']}: Weekly sync, 2026-11-20, 00:42, @anna @ivan, 2 unknown speakers, has note\n"
        f"- recording_id {base['interview']}: Interview, 2026-11-02, 00:15, @ivan\n"
        f"- recording_id {base['lecture']}: Lecture, 2026-10-15, 00:10"
    )


@pytest.mark.anyio
async def test_list_recordings_by_speaker_and_dates(base):
    assert "Weekly sync" in await _ok("list_recordings", {"speaker": "@anna"})
    assert "Interview" not in await _ok("list_recordings", {"speaker": "ANNA"})
    by_ivan = await _ok("list_recordings", {"speaker": "ivan"})
    assert by_ivan.startswith("2 recordings match, newest first:")
    november = await _ok("list_recordings", {"date_from": "2026-11-01", "date_to": "2026-11-20"})
    assert "Weekly sync" in november and "Interview" in november and "Lecture" not in november
    assert await _ok("list_recordings", {"date_from": "2026-12-01"}) == (
        "No recordings match: widen the dates or leave out the speaker."
    )


@pytest.mark.anyio
async def test_list_recordings_pages(base):
    text = await _ok("list_recordings", {"limit": 1, "offset": 1})
    assert text.splitlines() == [
        "3 recordings, newest first; 2–2 shown:",
        f"- recording_id {base['interview']}: Interview, 2026-11-02, 00:15, @ivan",
        "More: call list_recordings with offset=2.",
    ]


@pytest.mark.anyio
@pytest.mark.parametrize("arguments, message", [
    ({"speaker": "@petya"}, "No speaker has the handle @petya: use the handle of a named speaker (list_speakers)."),
    ({"date_from": "20.11.2026"}, "The from date '20.11.2026' is not a date: write it as YYYY-MM-DD."),
    ({"date_from": "2026-11-20", "date_to": "2026-11-01"},
     "The from date comes after the to date: give a from date on or before the to date."),
])
async def test_list_recordings_refuses_a_wrong_filter(base, arguments, message):
    assert await _error("list_recordings", arguments) == message


# ── list_speakers ─────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_list_speakers_gives_named_speakers_by_handle(base):
    base["memory"].create_named_speaker("Nobody Yet", handle="nobody")
    assert await _ok("list_speakers") == (
        "3 speakers with a name:\n"
        "- Anna Petrova @anna: 1 recording, 00:07 talk time, last 2026-11-20\n"
        "- Ivan Sidorov @ivan: 2 recordings, 00:10 talk time, last 2026-11-20\n"
        "- Nobody Yet @nobody: no recordings yet\n"
        "1 voice without a name is not listed: it has a label of its own in each recording "
        "(Unknown speaker N), and recordings cannot be filtered by it."
    )


# ── get_transcript ────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_get_transcript_gives_a_short_recording_whole(base):
    assert await _ok("get_transcript", {"recording_id": base["sync"]}) == (
        "Weekly sync\n"
        f"recording_id {base['sync']}, 2026-11-20 14:05, 00:42\n"
        "Speakers: Anna Petrova @anna, Ivan Sidorov @ivan, Unknown speaker 1, Unknown speaker 2\n\n"
        "Anna Petrova 00:00\nGood morning, we ship the release on Friday.\n\n"
        "Ivan Sidorov 00:09\nThe build is green.\n\n"
        "Unknown speaker 1 00:20\nWho is driving the release notes?\n\n"
        "Unknown speaker 2 00:30\nA voice diarization found and memory did not.\n\n"
        "Anna Petrova 00:40\nI am."
    )


@pytest.mark.anyio
async def test_get_transcript_of_a_recording_without_speakers(base):
    assert await _ok("get_transcript", {"recording_id": base["lecture"]}) == (
        "Lecture\n"
        f"recording_id {base['lecture']}, 2026-10-15 18:00, 00:10\n\n"
        "A recording without speakers.\nSecond paragraph."
    )


@pytest.mark.anyio
async def test_the_labels_of_a_range_are_those_of_the_whole_recording(base):
    text = await _ok("get_transcript", {"recording_id": base["sync"], "start": "00:25", "end": 35})
    assert text.endswith("Part 00:25–00:35\n\nUnknown speaker 2 00:30\nA voice diarization found and memory did not.")


@pytest.mark.anyio
async def test_a_long_recording_comes_as_contents_and_reads_by_range(base):
    storage, anna, ivan = base["storage"], base["anna"], base["ivan"]
    words = " ".join(["word"] * 60)
    long_id = _recording(storage, "All hands", "2026-11-21T10:00:00", [
        _seg(t, anna if i % 2 == 0 else ivan, words, length=20) for i, t in enumerate(range(0, 90 * 60, 30))
    ])
    contents = await _ok("get_transcript", {"recording_id": long_id})
    assert "Too long to return whole (" in contents
    assert f'get_transcript(recording_id={long_id}, start="00:00", end="05:00")' in contents
    assert contents.count("\n- ") == 18

    part = await _ok("get_transcript", {"recording_id": long_id, "start": "05:00", "end": "10:00"})
    assert "Part 05:00–10:00" in part
    assert "Anna Petrova 05:00" in part and "Ivan Sidorov 09:30" in part and "Anna Petrova 10:00" not in part

    rest = await _ok("get_transcript", {"recording_id": long_id, "start": "1:00:00"})
    assert "Anna Petrova 1:00:00" in rest and "Ivan Sidorov 1:29:30" in rest

    cut = await _ok("get_transcript", {"recording_id": long_id, "start": 0})
    assert cut.splitlines()[-1].startswith("Cut at ")


@pytest.mark.anyio
@pytest.mark.parametrize("arguments, message", [
    ({"recording_id": 999}, "Recording 999 not found: use list_recordings to see recording_ids."),
    ({"start": "10:00", "end": "05:00"}, "The end 05:00 is not after the start 10:00: give an end after the start."),
    ({"start": "1:00:00"}, "Recording {sync} is 00:42 long: give a start before 00:42."),
    ({"start": "five"}, "'five' is not a time: write it as mm:ss, h:mm:ss or seconds."),
])
async def test_get_transcript_refuses_in_one_line(base, arguments, message):
    arguments = {"recording_id": base["sync"], **arguments}
    assert await _error("get_transcript", arguments) == message.format(sync=base["sync"])


# ── search ────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_search_finds_segments_titles_and_notes_with_labels(base):
    text = await _ok("search", {"query": "release"})
    sync = base["sync"]
    assert text.startswith("4 hits in 2 recordings, newest first:")
    assert f"recording_id {sync}: Weekly sync, 2026-11-20 (3 hits)" in text
    assert "00:00 Anna Petrova @anna: Good morning, we ship the **release** on Friday." in text
    assert "00:20 Unknown speaker 1: Who is driving the **release** notes?" in text
    assert "note: **Release** checklist" in text
    assert f"recording_id {base['interview']}: Interview, 2026-11-02 (1 hit)" in text


@pytest.mark.anyio
async def test_search_by_speaker_and_within_one_recording(base):
    by_ivan = await _ok("search", {"query": "release", "speaker": "@ivan"})
    assert "Tell me about the **release** process." in by_ivan and "Anna Petrova" not in by_ivan
    one = await _ok("search", {"query": "release", "recording_id": base["interview"]})
    assert one.startswith(f"1 hit in recording {base['interview']}:")


@pytest.mark.anyio
@pytest.mark.parametrize("arguments, message", [
    ({"query": '"release'}, None),
    ({"query": "release", "speaker": "@petya"},
     "No speaker has the handle @petya: use the handle of a named speaker (list_speakers)."),
    ({"query": "release", "recording_id": 999}, "Recording 999 not found: use list_recordings to see recording_ids."),
])
async def test_search_refuses_in_one_line(base, arguments, message):
    text = await _error("search", arguments)
    if message:
        assert text == message
