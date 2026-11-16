"""POST /speakers: a speaker made by name alone, before any recording has them."""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_memory_service, get_storage_service
from app.api.main import app
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def client(tmp_path):
    db = str(tmp_path / "sonorus.db")
    shared = SpeakerMemoryService(db_path=db, photos_dir=tmp_path / "speaker_photos")
    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(db_path=db)
    app.dependency_overrides[get_memory_service] = lambda: shared
    yield TestClient(app)
    app.dependency_overrides.clear()


def _memory():
    return app.dependency_overrides[get_memory_service]()


def _rows(client):
    return client.get("/speakers").json()


def test_creates_a_named_speaker_with_no_recordings(client):
    r = client.post("/speakers", json={"name": "  Ivan Petrov ", "color_index": 3})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "Ivan Petrov"
    assert body["handle"] == "ivan.petrov"
    assert body["handle_manual"] is False
    assert body["color_index"] == 3
    assert (body["segments"], body["transcripts"], body["duration_sec"]) == (0, 0, 0.0)
    assert _rows(client) == [body]


def test_a_handle_given_by_hand_is_kept(client):
    r = client.post("/speakers", json={"name": "Ivan Petrov", "handle": " @Vanya "})
    assert r.status_code == 201, r.text
    assert (r.json()["handle"], r.json()["handle_manual"]) == ("vanya", True)


def test_a_name_another_speaker_has_is_allowed(client):
    first = client.post("/speakers", json={"name": "Anna"}).json()
    second = client.post("/speakers", json={"name": "Anna"}).json()
    assert first["id"] != second["id"]
    assert (first["handle"], second["handle"]) == ("anna", "anna2")


def test_a_taken_handle_is_refused_and_nothing_is_created(client):
    client.post("/speakers", json={"name": "Anna", "handle": "anna"})
    r = client.post("/speakers", json={"name": "Anna Smith", "handle": "ANNA"})
    assert r.status_code == 409
    assert r.json()["code"] == "handle_taken"
    assert [row["name"] for row in _rows(client)] == ["Anna"]


def test_an_invalid_handle_is_refused_and_nothing_is_created(client):
    r = client.post("/speakers", json={"name": "Anna", "handle": "anna smith"})
    assert r.status_code == 400
    assert r.json()["code"] == "handle_invalid"
    assert _rows(client) == []


@pytest.mark.parametrize("body", [{"name": "   "}, {"name": ""}, {}, {"name": "x" * 129}])
def test_a_name_is_required(client, body):
    assert client.post("/speakers", json=body).status_code in (400, 422)
    assert _rows(client) == []


def test_a_colour_outside_the_palette_is_refused_and_nothing_is_created(client):
    assert client.post("/speakers", json={"name": "Anna", "color_index": 9}).status_code == 400
    assert _rows(client) == []


def test_a_new_speaker_has_no_voice_profile(client):
    spk = client.post("/speakers", json={"name": "Anna"}).json()["id"]
    assert spk not in _memory().known_speakers
    assert spk in _memory().speaker_ids()


def test_segments_assigned_later_give_the_speaker_a_profile(client):
    spk = client.post("/speakers", json={"name": "Anna"}).json()["id"]
    storage = app.dependency_overrides[get_storage_service]()
    tid = storage.save(Transcript(audio_path="files/test.wav", language="en", segments=[
        Segment(0.0, 1.0, "Hello", "SPEAKER_00", embedding=np.array([1.0, 0.0, 0.0], dtype=np.float32)),
    ]))
    r = client.post(f"/transcripts/{tid}/speaker-assignments", json={"speaker_id": spk, "segment_starts": [0.0]})
    assert r.status_code == 200, r.text
    assert spk in _memory().known_speakers
    row = next(row for row in _rows(client) if row["id"] == spk)
    assert (row["segments"], row["transcripts"]) == (1, 1)


def test_a_new_speaker_takes_a_photo(client):
    spk = client.post("/speakers", json={"name": "Anna"}).json()["id"]
    r = client.put(f"/speakers/{spk}/photo", content=PNG, headers={"Content-Type": "image/png"})
    assert r.status_code == 200, r.text
    assert r.json()["photo"]
