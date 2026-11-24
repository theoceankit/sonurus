"""Notes of a recording: one Tiptap document per transcript, stored apart from
segments, removed with the recording."""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_memory_service, get_storage_service
from app.api.main import app
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService

DOC = {"type": "doc", "content": [
    {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Weekly sync"}]},
    {"type": "paragraph", "content": [
        {"type": "mention", "attrs": {"kind": "speaker", "id": "4f9c0c1e-2a1b-4c7e-9f00-6d1a2b3c4d5e", "label": "Anna"}},
        {"type": "text", "text": " "},
        {"type": "timecode", "attrs": {"seconds": 754}},
    ]},
]}


def _transcript():
    return Transcript(audio_path="files/meeting.wav", language="en", segments=[
        Segment(0.0, 2.0, "Hello", "SPEAKER_00", speaker_resolved="Alice"),
    ])


@pytest.fixture
def storage(tmp_path):
    return TranscriptStorageService(db_path=str(tmp_path / "t.db"))


# ── Storage ───────────────────────────────────────────────────────────────────

def test_a_transcript_has_no_note_at_first(storage):
    db_id = storage.save(_transcript())
    assert storage.get_note(db_id) is None
    assert storage.list_all()[0]["has_note"] is False


def test_save_note_keeps_the_document_as_is(storage):
    db_id = storage.save(_transcript())
    storage.save_note(db_id, DOC)
    note = storage.get_note(db_id)
    assert note["content"] == DOC, "chips keep their ids and attributes"
    assert note["updated_at"]
    assert storage.list_all()[0]["has_note"] is True


def test_save_note_again_replaces_it_and_keeps_one_row(storage, tmp_path):
    db_id = storage.save(_transcript())
    storage.save_note(db_id, DOC)
    first = storage.get_note(db_id)["updated_at"]
    other = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x"}]}]}
    storage.save_note(db_id, other)
    assert storage.get_note(db_id)["content"] == other
    assert storage.get_note(db_id)["updated_at"] >= first
    with sqlite3.connect(tmp_path / "t.db") as conn:
        assert conn.execute("SELECT COUNT(*), MIN(format) FROM notes").fetchone() == (1, 1)


def test_save_note_of_an_unknown_transcript_is_false(storage):
    assert storage.save_note(999, DOC) is False
    assert storage.get_note(999) is None


def test_delete_note(storage):
    db_id = storage.save(_transcript())
    storage.save_note(db_id, DOC)
    storage.delete_note(db_id)
    storage.delete_note(db_id)  # twice is fine
    assert storage.get_note(db_id) is None


def test_notes_are_per_transcript(storage):
    a, b = storage.save(_transcript()), storage.save(_transcript())
    storage.save_note(a, DOC)
    assert storage.get_note(b) is None
    assert {r["id"]: r["has_note"] for r in storage.list_all()} == {a: True, b: False}


def test_deleting_the_recording_deletes_its_note(storage, tmp_path):
    a, b = storage.save(_transcript()), storage.save(_transcript())
    storage.save_note(a, DOC)
    storage.save_note(b, DOC)
    storage.delete(a)
    with sqlite3.connect(tmp_path / "t.db") as conn:
        assert conn.execute("SELECT transcription_id FROM notes").fetchall() == [(b,)]


def test_clear_deletes_every_note(storage, tmp_path):
    storage.save_note(storage.save(_transcript()), DOC)
    storage.clear()
    with sqlite3.connect(tmp_path / "t.db") as conn:
        assert conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0] == 0


def test_notes_table_leaves_room_for_a_note_before_its_transcript(storage, tmp_path):
    """A note has its own id; the transcript may come later."""
    with sqlite3.connect(tmp_path / "t.db") as conn:
        cols = {r[1]: r for r in conn.execute("PRAGMA table_info(notes)").fetchall()}
        assert cols["id"][5] == 1, "own primary key"
        assert cols["transcription_id"][3] == 0, "transcription_id may be NULL"
        conn.execute("INSERT INTO notes (transcription_id, content, created_at, updated_at) VALUES (NULL, '{}', 'x', 'x')")
        conn.execute("INSERT INTO notes (transcription_id, content, created_at, updated_at) VALUES (NULL, '{}', 'x', 'x')")


def test_v8_database_migrates_to_notes(tmp_path):
    db = str(tmp_path / "old.db")
    TranscriptStorageService(db_path=db).save(_transcript())
    with sqlite3.connect(db) as conn:
        conn.execute("DROP TABLE notes")
        conn.execute("UPDATE _ts_schema_version SET version = 8")

    svc = TranscriptStorageService(db_path=db)

    from app.db.schema import SCHEMA_VERSION
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT version FROM _ts_schema_version").fetchone()[0] == SCHEMA_VERSION
    assert svc.list_all()[0]["has_note"] is False
    assert svc.save_note(1, DOC) is True


# ── API ───────────────────────────────────────────────────────────────────────

@pytest.fixture
def client(tmp_path):
    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(db_path=str(tmp_path / "t.db"))
    app.dependency_overrides[get_memory_service] = lambda: SpeakerMemoryService(db_path=str(tmp_path / "m.db"))
    yield TestClient(app)
    app.dependency_overrides.clear()


def _saved(client) -> int:
    return app.dependency_overrides[get_storage_service]().save(_transcript())


def test_get_note_without_one_is_null_not_an_error(client):
    db_id = _saved(client)
    r = client.get(f"/transcripts/{db_id}/note")
    assert r.status_code == 200
    assert r.json() == {"content": None, "updated_at": None}


def test_put_then_get_note(client):
    db_id = _saved(client)
    assert client.put(f"/transcripts/{db_id}/note", json={"content": DOC}).status_code == 204
    body = client.get(f"/transcripts/{db_id}/note").json()
    assert body["content"] == DOC
    assert body["updated_at"]
    assert client.get("/transcripts").json()[0]["has_note"] is True


def test_delete_note_route(client):
    db_id = _saved(client)
    client.put(f"/transcripts/{db_id}/note", json={"content": DOC})
    assert client.delete(f"/transcripts/{db_id}/note").status_code == 204
    assert client.delete(f"/transcripts/{db_id}/note").status_code == 204
    assert client.get(f"/transcripts/{db_id}/note").json()["content"] is None
    assert client.get("/transcripts").json()[0]["has_note"] is False


@pytest.mark.parametrize("method", ["get", "put", "delete"])
def test_note_of_an_unknown_transcript_is_404(client, method):
    kwargs = {"json": {"content": DOC}} if method == "put" else {}
    assert getattr(client, method)("/transcripts/999/note", **kwargs).status_code == 404


@pytest.mark.parametrize("content", [
    None, "text", [], {"type": "paragraph"}, {"content": []},
])
def test_put_note_needs_a_document(client, content):
    db_id = _saved(client)
    assert client.put(f"/transcripts/{db_id}/note", json={"content": content}).status_code == 422


def test_put_note_refuses_over_a_megabyte(client):
    db_id = _saved(client)
    big = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x" * 1_100_000}]}]}
    assert client.put(f"/transcripts/{db_id}/note", json={"content": big}).status_code == 422
    assert client.get(f"/transcripts/{db_id}/note").json()["content"] is None


def test_deleting_the_recording_through_the_api_deletes_its_note(client):
    db_id = _saved(client)
    client.put(f"/transcripts/{db_id}/note", json={"content": DOC})
    assert client.delete(f"/transcripts/{db_id}").status_code == 204
    other = _saved(client)
    assert client.get(f"/transcripts/{other}/note").json()["content"] is None


def test_note_routes_leave_speaker_memory_alone(client, monkeypatch):
    db_id = _saved(client)

    def no_write(*args, **kwargs):
        raise AssertionError("a note must not write speaker memory")
    monkeypatch.setattr(SpeakerMemoryService, "save", no_write)
    monkeypatch.setattr(SpeakerMemoryService, "update_embedding", no_write)

    client.put(f"/transcripts/{db_id}/note", json={"content": DOC})
    client.delete(f"/transcripts/{db_id}/note")
