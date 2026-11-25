"""WS /ws/events: what changed in the app's data, for the UI to follow, whoever
changed it. Today: note_changed."""
import threading

import pytest
from fastapi.testclient import TestClient

from app.api import routers
from app.api.dependencies import get_storage_service
from app.api.main import app
from app.api.schemas import EventsConnectedEvent, HeartbeatEvent, NoteChangedEvent
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.app_events import AppEvents, app_events
from app.services.transcript_storage_service import TranscriptStorageService

DOC = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hi"}]}]}


def _transcript():
    return Transcript(audio_path="files/meeting.wav", language="en", segments=[
        Segment(0.0, 2.0, "Hello", "SPEAKER_00", speaker_resolved="Alice"),
    ])


@pytest.fixture
def api(tmp_path):
    db = str(tmp_path / "t.db")
    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(db_path=db)
    yield TestClient(app), TranscriptStorageService(db_path=db)
    app.dependency_overrides.clear()


def _note_event(ws) -> dict:
    while True:
        event = ws.receive_json()
        if event["type"] != "heartbeat":
            return event


# ── The bus ───────────────────────────────────────────────────────────────────

def test_subscribers_hear_events_until_they_leave():
    events, seen = AppEvents(), []
    leave = events.subscribe(seen.append)
    events.publish({"type": "x"})
    leave()
    leave()  # twice is fine
    events.publish({"type": "y"})
    assert seen == [{"type": "x"}]


def test_a_failing_subscriber_does_not_stop_the_others():
    events, seen = AppEvents(), []

    def broken(event):
        raise RuntimeError("boom")
    events.subscribe(broken)
    events.subscribe(seen.append)
    events.publish({"type": "x"})
    assert seen == [{"type": "x"}]


def test_storage_announces_on_the_app_bus_by_default(tmp_path):
    seen = []
    leave = app_events.subscribe(seen.append)
    try:
        storage = TranscriptStorageService(db_path=str(tmp_path / "t.db"))
        db_id = storage.save(_transcript())
        storage.save_note(db_id, DOC)
    finally:
        leave()
    assert [e["type"] for e in seen] == ["note_changed"]


# ── The socket ────────────────────────────────────────────────────────────────

def test_ws_says_it_is_connected_first(api):
    client, _ = api
    with client.websocket_connect("/ws/events") as ws:
        event = ws.receive_json()
    assert event == {"type": "connected"}
    assert EventsConnectedEvent.model_validate(event).model_dump() == event


def test_ws_sends_note_changed_for_a_put_and_a_delete(api):
    client, storage = api
    db_id = storage.save(_transcript())
    with client.websocket_connect("/ws/events") as ws:
        ws.receive_json()
        v = client.put(f"/transcripts/{db_id}/note",
                       json={"content": DOC, "writer": {"kind": "mcp", "name": "Claude Code"}}).json()["version"]
        saved = _note_event(ws)
        client.delete(f"/transcripts/{db_id}/note", params={"writer_kind": "editor"})
        deleted = _note_event(ws)
    assert saved == {"type": "note_changed", "transcript_id": db_id, "version": v,
                     "writer": {"kind": "mcp", "name": "Claude Code"}}
    assert NoteChangedEvent.model_validate(saved).model_dump() == saved
    assert deleted == {"type": "note_changed", "transcript_id": db_id, "version": None,
                       "writer": {"kind": "editor", "name": None}}


def test_ws_hears_a_write_from_another_thread(api):
    client, storage = api
    db_id = storage.save(_transcript())
    with client.websocket_connect("/ws/events") as ws:
        ws.receive_json()
        writer = threading.Thread(target=storage.save_note, args=(db_id, DOC))
        writer.start()
        writer.join()
        assert _note_event(ws)["transcript_id"] == db_id


def test_ws_sends_heartbeats_while_quiet(api, monkeypatch):
    monkeypatch.setattr(routers.events, "_HEARTBEAT_INTERVAL", 0.01)
    client, _ = api
    with client.websocket_connect("/ws/events") as ws:
        ws.receive_json()
        event = ws.receive_json()
    assert HeartbeatEvent.model_validate(event).model_dump() == event


def test_a_closed_socket_stops_listening(api):
    client, _ = api
    before = len(app_events._subscribers)
    with client.websocket_connect("/ws/events") as ws:
        ws.receive_json()
        assert len(app_events._subscribers) == before + 1
    # The route leaves once it notices the socket is gone: the next event or heartbeat.
    app_events.publish({"type": "heartbeat"})
    for _ in range(100):
        if len(app_events._subscribers) == before:
            break
        threading.Event().wait(0.01)
    assert len(app_events._subscribers) == before
