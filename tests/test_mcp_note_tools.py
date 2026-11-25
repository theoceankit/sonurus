"""The MCP tools that write the note of a recording: append_note, replace_note
and edit_note. The changes themselves are pure (app/mcp/note_changes.py) and
tested on their own; the tools are called by the SDK's client against a
temporary database, as in test_mcp_server.py."""
import httpx2
import pytest
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from app.api.dependencies import get_app_settings, get_memory_service, get_storage_service
from app.api.main import app, mcp_endpoint
from app.mcp import note_changes
from app.mcp.note_changes import NoteToolError, appended, edited, replaced, reply
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.app_events import AppEvents
from app.services.app_settings import MCP_ENABLED
from app.services.note_markdown import NoteSpeaker, NoteSpeakers, markdown_to_note, note_to_markdown
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import NoteVersionConflict, TranscriptStorageService

URL = "http://127.0.0.1:8000/mcp"
ANNA = "3b0f6c8e-1a2d-4c5e-9f00-000000000001"
SPEAKERS = NoteSpeakers(speakers=[NoteSpeaker(id=ANNA, name="Anna Petrova", handle="anna")], unnamed={})


def _doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


def _p(*content):
    return {"type": "paragraph", "content": list(content)} if content else {"type": "paragraph"}


def _t(text):
    return {"type": "text", "text": text}


def _md(text):
    return markdown_to_note(text, SPEAKERS).doc


# ── The changes, pure ─────────────────────────────────────────────────────────

def test_append_adds_blocks_after_the_note_and_keeps_it_as_stored():
    # Stored as the editor saved it, not in the normal form: a trailing empty
    # paragraph and a space at the end of the text.
    stored = _doc(_p(_t("First ")), _p())
    result = appended(stored, "Second\n\n- one\n- two", SPEAKERS, recording_id=1)
    assert result.doc["content"][:2] == stored["content"]
    assert result.doc["content"][2:] == _md("Second\n\n- one\n- two")["content"]
    assert result.warnings == []


def test_append_to_no_note_is_the_note():
    assert appended(None, "Hello", SPEAKERS, recording_id=1).doc == _md("Hello")
    empty = _doc(_p())
    assert appended(empty, "Hello", SPEAKERS, recording_id=1).doc == _md("Hello")


def test_append_drops_empty_lines_at_the_edges_of_the_new_text():
    result = appended(_doc(_p(_t("A"))), "\n\n\n\nB\n\n\n\n", SPEAKERS, recording_id=1)
    assert result.doc == _doc(_p(_t("A")), _p(_t("B")))


def test_append_of_nothing_is_refused():
    with pytest.raises(NoteToolError, match=r"^Nothing to append to the note of recording 4: "):
        appended(None, "  \n\n ", SPEAKERS, recording_id=4)


def test_timecodes_and_handles_become_chips():
    doc = appended(None, "[01:15] @anna agreed", SPEAKERS, recording_id=1).doc
    kinds = [node["type"] for node in doc["content"][0]["content"]]
    assert "timecode" in kinds and "mention" in kinds


def test_an_unknown_handle_is_kept_as_text_with_a_hint():
    result = appended(None, "Ask @petya", SPEAKERS, recording_id=1)
    assert result.doc == _doc(_p(_t("Ask @petya")))
    assert result.warnings == [
        "Unknown handles kept as text: @petya. "
        "Use list_speakers for handles, or @[Name] for someone not in Sonorus."
    ]


def test_markup_the_note_does_not_have_is_simplified_with_a_warning():
    result = replaced("| a | b |\n|---|---|\n| 1 | 2 |", SPEAKERS)
    assert result.warnings == ["Tables became plain text."]


def test_replace_is_the_markdown_as_a_note():
    assert replaced("# Title\n\nText", SPEAKERS).doc == _md("# Title\n\nText")


def test_edit_replaces_the_one_place_the_text_is():
    stored = _md("Budget is **10k**.\n\nNext call on Monday.")
    result = edited(stored, "Monday", "Friday", SPEAKERS, recording_id=1)
    assert result.doc == _md("Budget is **10k**.\n\nNext call on Friday.")


def test_edit_matches_the_markdown_as_read_with_its_markup_and_escapes():
    stored = _doc(_p(_t("2 * 3 = 6")))
    assert note_to_markdown(stored, SPEAKERS) == "2 \\* 3 = 6"
    with pytest.raises(NoteToolError):
        edited(stored, "2 * 3", "3 * 3", SPEAKERS, recording_id=1)
    assert edited(stored, "2 \\* 3 = 6", "2 \\* 3 = 7", SPEAKERS, recording_id=1).doc == _doc(_p(_t("2 * 3 = 7")))


def test_edit_with_an_empty_new_text_removes_the_text():
    stored = _md("Keep this. Drop this.")
    assert edited(stored, " Drop this.", "", SPEAKERS, recording_id=1).doc == _md("Keep this.")


def test_edit_of_text_not_in_the_note_is_refused():
    with pytest.raises(NoteToolError) as error:
        edited(_md("Hello"), "Bye", "Hi", SPEAKERS, recording_id=12)
    assert str(error.value) == (
        "Text not found in the note of recording 12: copy it exactly from get_note, escapes included."
    )


def test_edit_of_text_found_more_than_once_is_refused():
    with pytest.raises(NoteToolError) as error:
        edited(_md("ab ab ab"), "ab", "x", SPEAKERS, recording_id=12)
    assert str(error.value) == (
        "Text appears 3 times in the note of recording 12: add surrounding text so it appears once."
    )


def test_overlapping_places_count_as_more_than_one():
    with pytest.raises(NoteToolError, match="appears 2 times"):
        edited(_md("aaa"), "aa", "b", SPEAKERS, recording_id=1)


def test_edit_with_an_empty_old_text_is_refused():
    with pytest.raises(NoteToolError, match=r"^old_text is empty: "):
        edited(_md("Hello"), "", "x", SPEAKERS, recording_id=1)


def test_edit_of_no_note_is_refused():
    with pytest.raises(NoteToolError) as error:
        edited(None, "a", "b", SPEAKERS, recording_id=12)
    assert str(error.value) == "Recording 12 has no note: use append_note or replace_note."


def test_reply_is_one_line_and_the_warnings_after_it():
    assert reply("Appended to the note of recording 12 (version 8).", []) == (
        "Appended to the note of recording 12 (version 8)."
    )
    assert reply("Edited the note of recording 3 (version 2).", ["Tables became plain text."]) == (
        "Edited the note of recording 3 (version 2).\nTables became plain text."
    )


# ── The tools, through the SDK's client ───────────────────────────────────────

@pytest.fixture
def events(monkeypatch):
    bus = AppEvents()
    seen = []
    bus.subscribe(seen.append)
    return bus, seen


@pytest.fixture
def services(tmp_path, events):
    db = str(tmp_path / "data.db")
    storage = TranscriptStorageService(db_path=db, events=events[0])
    memory = SpeakerMemoryService(db_path=db)
    app.dependency_overrides[get_storage_service] = lambda: storage
    app.dependency_overrides[get_memory_service] = lambda: memory
    app.dependency_overrides[get_app_settings]().set_bool(MCP_ENABLED, True)
    yield storage, memory
    app.dependency_overrides.pop(get_storage_service, None)
    app.dependency_overrides.pop(get_memory_service, None)


def _recording(storage, speakers=("SPEAKER_00",)):
    segments = [Segment(float(i), float(i) + 1, f"Line {i}", raw) for i, raw in enumerate(speakers)]
    return storage.save(Transcript(audio_path="recordings/a.wav", language="en", segments=segments))


async def _call(name, arguments):
    async with mcp_endpoint.running(), httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="http://127.0.0.1:8000"
    ) as http:
        async with Client(streamable_http_client(URL, http_client=http)) as client:
            return await client.call_tool(name, arguments)


async def _tools():
    async with mcp_endpoint.running(), httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="http://127.0.0.1:8000"
    ) as http:
        async with Client(streamable_http_client(URL, http_client=http)) as client:
            return {tool.name: tool for tool in (await client.list_tools()).tools}


def _text(result):
    return result.content[0].text


def _markdown(storage, memory, db_id):
    from app.services.transcript_text import note_speakers
    note = storage.get_note(db_id)
    return note_to_markdown(note["content"], note_speakers(storage, memory, db_id)) if note else None


@pytest.mark.anyio
async def test_the_note_tools_are_listed_with_their_parameters(services):
    tools = await _tools()
    assert set(tools) >= {"get_note", "append_note", "replace_note", "edit_note"}
    assert set(tools["get_note"].input_schema["required"]) == {"recording_id"}
    assert set(tools["append_note"].input_schema["required"]) == {"recording_id", "markdown"}
    assert set(tools["replace_note"].input_schema["required"]) == {"recording_id", "markdown", "version"}
    assert set(tools["edit_note"].input_schema["required"]) == {"recording_id", "old_text", "new_text"}
    for name in ("get_note", "append_note", "replace_note", "edit_note"):
        assert tools[name].description


@pytest.mark.anyio
async def test_get_note_gives_the_version_and_the_markdown(services):
    storage, memory = services
    anna = memory.create_named_speaker("Anna Petrova", handle="anna")
    db_id = _recording(storage)
    base = NoteSpeakers(speakers=[NoteSpeaker(id=anna, name="Anna Petrova", handle="anna")], unnamed={})
    storage.save_note(db_id, markdown_to_note("# Minutes\n\n[01:15] @anna agreed", base).doc)
    version = storage.get_note(db_id)["version"]
    result = await _call("get_note", {"recording_id": db_id})
    assert not result.is_error
    assert _text(result) == f"Note of recording {db_id} (version {version}):\n\n# Minutes\n\n[01:15] @anna agreed"
    assert storage.get_note(db_id)["content"]["content"][1]["content"][2]["attrs"]["id"] == anna


@pytest.mark.anyio
async def test_get_note_of_a_recording_without_one(services):
    storage, memory = services
    db_id = _recording(storage)
    result = await _call("get_note", {"recording_id": db_id})
    assert not result.is_error
    assert _text(result) == (
        f"Recording {db_id} has no note yet (version 0): add one with append_note or replace_note."
    )


@pytest.mark.anyio
async def test_a_note_read_and_written_back_through_the_tools_stays_the_same(services):
    storage, memory = services
    db_id = _recording(storage)
    storage.save_note(db_id, _md("Text  with **bold** and a list\n\n- [x] done\n- [ ] not yet"))
    before = storage.get_note(db_id)
    header, body = _text(await _call("get_note", {"recording_id": db_id})).split("\n\n", 1)
    result = await _call("replace_note", {"recording_id": db_id, "markdown": body, "version": before["version"]})
    assert "is unchanged" in _text(result)
    assert storage.get_note(db_id) == before


@pytest.mark.anyio
async def test_append_creates_the_note_then_adds_to_it(services, events):
    storage, memory = services
    db_id = _recording(storage)

    first = await _call("append_note", {"recording_id": db_id, "markdown": "Hello"})
    assert not first.is_error
    v1 = storage.get_note(db_id)["version"]
    assert _text(first) == f"Appended to the note of recording {db_id} (version {v1})."

    second = await _call("append_note", {"recording_id": db_id, "markdown": "World"})
    v2 = storage.get_note(db_id)["version"]
    assert _text(second) == f"Appended to the note of recording {db_id} (version {v2})."
    assert _markdown(storage, memory, db_id) == "Hello\n\nWorld"

    changes = [event for event in events[1] if event.get("type") == "note_changed"]
    assert [event["version"] for event in changes] == [v1, v2]
    # The SDK's client names itself "mcp"; Claude Code gives its own name.
    assert all(event["writer"] == {"kind": "mcp", "name": "mcp"} for event in changes)


@pytest.mark.anyio
async def test_a_handle_of_the_base_becomes_a_chip(services):
    storage, memory = services
    anna = memory.create_named_speaker("Anna Petrova", handle="anna")
    db_id = _recording(storage)
    result = await _call("append_note", {"recording_id": db_id, "markdown": "@anna at [00:01] and @petya"})
    assert "Unknown handles kept as text: @petya." in _text(result)
    mention = storage.get_note(db_id)["content"]["content"][0]["content"][0]
    assert mention["type"] == "mention" and mention["attrs"]["id"] == anna


@pytest.mark.anyio
async def test_an_unnamed_speaker_of_the_recording_is_mentioned_by_its_label(services):
    storage, memory = services
    db_id = _recording(storage, speakers=("SPEAKER_00", "SPEAKER_01"))
    await _call("append_note", {"recording_id": db_id, "markdown": "@[Unknown speaker 2] asked"})
    mention = storage.get_note(db_id)["content"]["content"][0]["content"][0]
    assert mention["attrs"]["id"] == "SPEAKER_01"


@pytest.mark.anyio
async def test_replace_with_the_version_read(services):
    storage, memory = services
    db_id = _recording(storage)
    storage.save_note(db_id, _md("Old"))
    version = storage.get_note(db_id)["version"]

    result = await _call("replace_note", {"recording_id": db_id, "markdown": "New", "version": version})
    assert not result.is_error
    now = storage.get_note(db_id)["version"]
    assert _text(result) == f"Replaced the note of recording {db_id} (version {now})."
    assert _markdown(storage, memory, db_id) == "New"


@pytest.mark.anyio
async def test_replace_of_a_note_changed_since_is_refused_and_keeps_it(services):
    storage, memory = services
    db_id = _recording(storage)
    storage.save_note(db_id, _md("Old"))
    read = storage.get_note(db_id)["version"]
    storage.save_note(db_id, _md("Typed by the user"))
    now = storage.get_note(db_id)["version"]

    result = await _call("replace_note", {"recording_id": db_id, "markdown": "New", "version": read})
    assert result.is_error
    assert _text(result) == (
        f"The note of recording {db_id} changed since version {read} (now version {now}): "
        "read it with get_note and replace again."
    )
    assert _markdown(storage, memory, db_id) == "Typed by the user"


@pytest.mark.anyio
async def test_replace_with_version_0_writes_only_when_there_is_no_note(services):
    storage, memory = services
    db_id = _recording(storage)
    created = await _call("replace_note", {"recording_id": db_id, "markdown": "First", "version": 0})
    assert not created.is_error
    version = storage.get_note(db_id)["version"]

    refused = await _call("replace_note", {"recording_id": db_id, "markdown": "Again", "version": 0})
    assert refused.is_error
    assert _text(refused) == (
        f"The note of recording {db_id} changed since no note (now version {version}): "
        "read it with get_note and replace again."
    )


@pytest.mark.anyio
async def test_a_note_written_back_unchanged_stays_the_same(services):
    storage, memory = services
    db_id = _recording(storage)
    storage.save_note(db_id, _md("# Minutes\n\n- [ ] Send **draft**\n\n> quote"))
    before = storage.get_note(db_id)

    result = await _call("replace_note", {
        "recording_id": db_id, "markdown": _markdown(storage, memory, db_id), "version": before["version"],
    })
    assert _text(result) == f"The note of recording {db_id} is unchanged (version {before['version']})."
    assert storage.get_note(db_id) == before


@pytest.mark.anyio
async def test_replace_with_nothing_removes_the_note(services):
    storage, memory = services
    db_id = _recording(storage)
    storage.save_note(db_id, _md("Old"))
    version = storage.get_note(db_id)["version"]
    result = await _call("replace_note", {"recording_id": db_id, "markdown": "", "version": version})
    assert _text(result) == f"The note of recording {db_id} is now empty and was removed."
    assert storage.get_note(db_id) is None


@pytest.mark.anyio
async def test_edit_changes_one_place(services):
    storage, memory = services
    db_id = _recording(storage)
    storage.save_note(db_id, _md("Next call on Monday."))
    result = await _call("edit_note", {"recording_id": db_id, "old_text": "Monday", "new_text": "Friday"})
    now = storage.get_note(db_id)["version"]
    assert _text(result) == f"Edited the note of recording {db_id} (version {now})."
    assert _markdown(storage, memory, db_id) == "Next call on Friday."


@pytest.mark.anyio
async def test_edit_that_empties_the_note_removes_it(services):
    storage, memory = services
    db_id = _recording(storage)
    storage.save_note(db_id, _md("Only this"))
    result = await _call("edit_note", {"recording_id": db_id, "old_text": "Only this", "new_text": ""})
    assert _text(result) == f"The note of recording {db_id} is now empty and was removed."
    assert storage.get_note(db_id) is None


@pytest.mark.anyio
async def test_a_refused_edit_changes_nothing(services):
    storage, memory = services
    db_id = _recording(storage)
    storage.save_note(db_id, _md("ab ab"))
    before = storage.get_note(db_id)
    result = await _call("edit_note", {"recording_id": db_id, "old_text": "ab", "new_text": "x"})
    assert result.is_error
    assert "appears 2 times" in _text(result)
    assert storage.get_note(db_id) == before


@pytest.mark.anyio
@pytest.mark.parametrize("name, arguments", [
    ("get_note", {}),
    ("append_note", {"markdown": "x"}),
    ("replace_note", {"markdown": "x", "version": 0}),
    ("edit_note", {"old_text": "a", "new_text": "b"}),
])
async def test_a_recording_that_does_not_exist(services, name, arguments):
    result = await _call(name, {"recording_id": 999, **arguments})
    assert result.is_error
    assert _text(result) == "Recording 999 not found: use list_recordings to see recording_ids."


@pytest.mark.anyio
async def test_a_write_that_races_another_is_tried_again(services, monkeypatch):
    storage, memory = services
    db_id = _recording(storage)
    storage.save_note(db_id, _md("Start"))
    real_save = TranscriptStorageService.save_note
    raced = []

    def save_after_the_user(self, transcript_id, content, *, expected, writer=None):
        if not raced:
            # The user's editor saves between the tool's read and its write.
            raced.append(True)
            real_save(self, transcript_id, _md("Start, typed"))
        return real_save(self, transcript_id, content, expected=expected, writer=writer)

    monkeypatch.setattr(TranscriptStorageService, "save_note", save_after_the_user)
    result = await _call("append_note", {"recording_id": db_id, "markdown": "Agent"})
    assert not result.is_error
    assert _markdown(storage, memory, db_id) == "Start, typed\n\nAgent"


@pytest.mark.anyio
async def test_a_note_that_keeps_changing_is_given_up_on(services, monkeypatch):
    storage, memory = services
    db_id = _recording(storage)
    storage.save_note(db_id, _md("Start"))

    def always_late(self, transcript_id, content, *, expected, writer=None):
        raise NoteVersionConflict(10_000)

    monkeypatch.setattr(TranscriptStorageService, "save_note", always_late)
    result = await _call("edit_note", {"recording_id": db_id, "old_text": "Start", "new_text": "End"})
    assert result.is_error
    assert _text(result) == (
        f"The note of recording {db_id} keeps changing while it is written: try again in a moment."
    )
    assert note_changes.ATTEMPTS == 3


@pytest.fixture
def anyio_backend():
    return "asyncio"
