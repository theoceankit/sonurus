"""Mentions of a speaker in notes follow the speaker: merged into B, they mention
B; deleted, they become plain text with the name the speaker had."""
import json
import uuid as uuid_module

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import (
    get_live_recording_service, get_memory_service, get_storage_service, get_transcription_queue,
)
from app.api.main import app
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService

X = np.array([1.0, 0.0, 0.0], dtype=np.float32)


def _mention(spk, label):
    return {"type": "mention", "attrs": {"kind": "speaker", "id": spk, "label": label}}


def _text(value):
    return {"type": "text", "text": value}


PERSON = {"type": "mention", "attrs": {"kind": "person", "id": None, "label": "Slack Person"}}


def _note(a, b):
    """A heading, a paragraph with A, B and a person, a quote opening with A, and A
    in a checkbox."""
    return {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 1}, "content": [_text("Sync")]},
        {"type": "paragraph", "content": [_text("Ask "), _mention(a, "Anna"), _text(" and "), _mention(b, "Mark"), _text(" "), PERSON]},
        {"type": "blockquote", "content": [
            {"type": "paragraph", "content": [_mention(a, "Anna"), _text(" "), {"type": "timecode", "attrs": {"seconds": 12}}]},
            {"type": "paragraph", "content": [_text("Hello")]},
        ]},
        {"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": False}, "content": [
            {"type": "paragraph", "content": [_mention(a, "Anna")]},
        ]}]},
    ]}


def _recording(storage):
    return storage.save(Transcript(audio_path="files/test.wav", language="en", segments=[
        Segment(0.0, 1.0, "Hello", "SPEAKER_00", speaker_resolved=None),
    ]))


def _mentions(doc):
    found = []

    def walk(node):
        if node.get("type") == "mention":
            found.append((node["attrs"]["kind"], node["attrs"]["id"]))
        for child in node.get("content", []):
            walk(child)
    walk(doc)
    return found


def _texts(doc):
    found = []

    def walk(node):
        if node.get("type") == "text":
            found.append(node["text"])
        for child in node.get("content", []):
            walk(child)
    walk(doc)
    return found


@pytest.fixture
def db(tmp_path):
    return str(tmp_path / "sonorus.db")


@pytest.fixture
def storage(db):
    return TranscriptStorageService(db_path=db)


# ── Storage ───────────────────────────────────────────────────────────────────

def test_merge_moves_every_mention_of_a_to_b(storage):
    a, b = str(uuid_module.uuid4()), str(uuid_module.uuid4())
    first, second = _recording(storage), _recording(storage)
    storage.save_note(first, _note(a, b))
    storage.save_note(second, _note(a, b))

    assert storage.rewrite_note_mentions(a, into_id=b) == 2

    for db_id in (first, second):
        doc = storage.get_note(db_id)["content"]
        assert _mentions(doc) == [("speaker", b), ("speaker", b), ("person", None), ("speaker", b), ("speaker", b)]
        assert doc["content"][0] == _note(a, b)["content"][0], "the rest of the note is as it was"


def test_delete_turns_each_mention_into_its_name_as_text(storage):
    a, b = str(uuid_module.uuid4()), str(uuid_module.uuid4())
    db_id = _recording(storage)
    storage.save_note(db_id, _note(a, b))

    assert storage.rewrite_note_mentions(a, name="Anna Petrova") == 1

    doc = storage.get_note(db_id)["content"]
    assert _mentions(doc) == [("speaker", b), ("person", None)]
    assert _texts(doc).count("Anna Petrova") == 3
    assert doc["content"][1]["content"][1] == _text("Anna Petrova")
    assert doc["content"][2]["content"][0]["content"][0] == _text("Anna Petrova")


def test_delete_without_a_name_keeps_the_label_the_mention_had(storage):
    a, b = str(uuid_module.uuid4()), str(uuid_module.uuid4())
    db_id = _recording(storage)
    storage.save_note(db_id, _note(a, b))
    storage.rewrite_note_mentions(a)
    assert _texts(storage.get_note(db_id)["content"]).count("Anna") == 3


def test_text_that_only_contains_the_id_is_left_alone(storage):
    a = str(uuid_module.uuid4())
    db_id = _recording(storage)
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": [_text(f"id {a}")]}]}
    storage.save_note(db_id, doc)
    before = storage.get_note(db_id)

    assert storage.rewrite_note_mentions(a, into_id=str(uuid_module.uuid4())) == 0
    assert storage.get_note(db_id) == before, "content and updated_at untouched"


def test_notes_without_the_speaker_are_not_written(storage):
    a, b, c = (str(uuid_module.uuid4()) for _ in range(3))
    db_id = _recording(storage)
    storage.save_note(db_id, _note(b, c))
    before = storage.get_note(db_id)
    assert storage.rewrite_note_mentions(a, into_id=b) == 0
    assert storage.get_note(db_id) == before


# ── API ───────────────────────────────────────────────────────────────────────

class _Idle:
    on = False
    running = False

    def is_recording(self):
        return False

    def is_running(self):
        return False


@pytest.fixture
def client(db, tmp_path):
    photos = tmp_path / "speaker_photos"
    photos.mkdir()
    memory = SpeakerMemoryService(db_path=db, photos_dir=photos)
    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(db_path=db)
    app.dependency_overrides[get_memory_service] = lambda: memory
    app.dependency_overrides[get_live_recording_service] = lambda: _Idle()
    app.dependency_overrides[get_transcription_queue] = lambda: _Idle()
    yield TestClient(app)
    app.dependency_overrides.clear()


def _api_memory():
    return app.dependency_overrides[get_memory_service]()


def _api_storage():
    return app.dependency_overrides[get_storage_service]()


def test_merge_route_moves_mentions_in_notes(client):
    a = _api_memory().create_named_speaker("Anna Petrova")
    b = _api_memory().create_named_speaker("Mark Ellis")
    db_id = _recording(_api_storage())
    client.put(f"/transcripts/{db_id}/note", json={"content": _note(a, b)})

    assert client.post(f"/speakers/{a}/merge", json={"into_id": b}).status_code == 200

    doc = client.get(f"/transcripts/{db_id}/note").json()["content"]
    assert [spk for kind, spk in _mentions(doc) if kind == "speaker"] == [b, b, b, b]


def test_delete_route_turns_mentions_into_the_current_name(client):
    a = _api_memory().create_named_speaker("Anna Petrova")
    b = _api_memory().create_named_speaker("Mark Ellis")
    _api_memory().update_embedding(a, X)
    _api_memory().save()
    db_id = _recording(_api_storage())
    client.put(f"/transcripts/{db_id}/note", json={"content": _note(a, b)})

    assert client.delete(f"/speakers/{a}").status_code == 200

    doc = client.get(f"/transcripts/{db_id}/note").json()["content"]
    assert [spk for kind, spk in _mentions(doc) if kind == "speaker"] == [b]
    assert _texts(doc).count("Anna Petrova") == 3, "the name it had, not the label the note kept"
    assert a not in json.dumps(doc)
