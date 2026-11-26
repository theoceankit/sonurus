"""Speaker photos: schema v5, the files in the photos dir, the API routes, and
what happens to a photo when its speaker is deleted or the data is reset."""
import sqlite3
import uuid as uuid_module

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_live_recording_service, get_memory_service, get_storage_service
from app.api.main import app
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.commit_service import CommitService
from app.services.speaker_memory_service import PhotoNeedsName, SpeakerMemoryService
from app.services.speaker_photos import MAX_PHOTO_BYTES, remove_orphan_photos, save_photo
from app.services.transcript_storage_service import TranscriptStorageService

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 64


@pytest.fixture
def photos(tmp_path):
    return tmp_path / "speaker_photos"


@pytest.fixture
def memory(tmp_path, photos):
    return SpeakerMemoryService(db_path=str(tmp_path / "sonorus.db"), photos_dir=photos)


def _files(photos):
    return sorted(p.name for p in photos.iterdir()) if photos.exists() else []


# ── memory ────────────────────────────────────────────────────────────────────

def test_set_photo_stores_the_file_and_its_name(memory, photos):
    spk = memory.create_named_speaker("Anna")
    name = memory.set_photo(spk, JPEG, "image/jpeg")
    assert name.endswith(".jpg")
    assert (photos / name).read_bytes() == JPEG
    assert SpeakerMemoryService(db_path=memory.db_path).get_photo(spk) == name


def test_a_photo_keeps_colour_and_handle(memory):
    spk = memory.create_named_speaker("Anna", handle="anna.k")
    memory.set_color(spk, 3)
    memory.set_photo(spk, PNG, "image/png")
    fresh = SpeakerMemoryService(db_path=memory.db_path)
    assert fresh.get_color_index(spk) == 3
    assert fresh.get_handle(spk) == "anna.k"
    # And a colour or handle written after it keeps the photo.
    memory.set_color(spk, 1)
    memory.set_handle(spk, "anna.x")
    assert SpeakerMemoryService(db_path=memory.db_path).get_photo(spk) == memory.get_photo(spk)


def test_a_new_photo_replaces_the_file(memory, photos):
    spk = memory.create_named_speaker("Anna")
    first = memory.set_photo(spk, JPEG, "image/jpeg")
    second = memory.set_photo(spk, WEBP, "image/webp")
    assert first != second
    assert _files(photos) == [second]


def test_remove_photo_deletes_the_file(memory, photos):
    spk = memory.create_named_speaker("Anna")
    memory.set_photo(spk, JPEG, "image/jpeg")
    memory.remove_photo(spk)
    assert memory.get_photo(spk) is None
    assert _files(photos) == []
    assert SpeakerMemoryService(db_path=memory.db_path).get_photo(spk) is None


def test_an_unnamed_speaker_has_no_photo(memory, photos):
    spk = str(uuid_module.uuid4())
    memory.update_embedding(spk, np.ones(3, dtype=np.float32))
    memory.save()
    with pytest.raises(PhotoNeedsName):
        memory.set_photo(spk, JPEG, "image/jpeg")
    assert _files(photos) == []


@pytest.mark.parametrize("data,mime", [(PNG, "image/jpeg"), (JPEG, "image/webp"), (b"GIF89a", "image/gif")])
def test_bytes_must_be_the_image_they_claim(memory, photos, data, mime):
    spk = memory.create_named_speaker("Anna")
    with pytest.raises(ValueError):
        memory.set_photo(spk, data, mime)
    assert _files(photos) == []


def test_a_photo_writes_no_voice_profile(memory):
    spk = memory.create_named_speaker("Anna")
    memory.set_photo(spk, JPEG, "image/jpeg")
    assert spk not in memory.known_speakers
    assert SpeakerMemoryService(db_path=memory.db_path).known_speakers == {}


def test_deleting_a_speaker_deletes_the_photo(tmp_path, memory, photos):
    spk = memory.create_named_speaker("Anna")
    memory.set_photo(spk, JPEG, "image/jpeg")
    CommitService(memory, TranscriptStorageService(db_path=memory.db_path)).delete_speaker(spk)
    assert _files(photos) == []
    assert memory.get_photo(spk) is None


def test_forgetting_the_voice_keeps_the_photo(memory, photos):
    spk = memory.create_named_speaker("Anna")
    memory.update_embedding(spk, np.ones(3, dtype=np.float32))
    memory.save()
    name = memory.set_photo(spk, JPEG, "image/jpeg")
    memory.remove_embedding(spk)
    assert memory.get_photo(spk) == name
    assert _files(photos) == [name]


def test_an_instance_without_a_photos_dir_leaves_files_alone(memory, photos):
    spk = memory.create_named_speaker("Anna")
    name = memory.set_photo(spk, JPEG, "image/jpeg")
    job = SpeakerMemoryService(db_path=memory.db_path)  # as a pipeline job holds one
    job.remove_speaker(spk)
    assert _files(photos) == [name]
    # The next start removes it.
    assert remove_orphan_photos(photos, memory.photo_names()) == 1
    assert _files(photos) == []


def test_orphan_sweep_keeps_referenced_photos(memory, photos):
    spk = memory.create_named_speaker("Anna")
    name = memory.set_photo(spk, JPEG, "image/jpeg")
    stray = save_photo(PNG, "image/png", photos)
    assert remove_orphan_photos(photos, memory.photo_names()) == 1
    assert _files(photos) == [name]
    assert stray not in _files(photos)


def test_a_release_before_photos_gets_the_photo_column(tmp_path):
    from app.db.migrations import LATEST
    from db_releases import as_release, user_version
    db = tmp_path / "old.db"
    SpeakerMemoryService(db_path=str(db), photos_dir=tmp_path / "p")
    with sqlite3.connect(db) as conn:
        conn.execute("ALTER TABLE speaker_meta DROP COLUMN photo")
        conn.execute("INSERT INTO speaker_names (speaker_id, label, name) VALUES ('s1', 'display', 'Anna')")
        conn.execute("INSERT INTO speaker_meta VALUES ('s1', 2, 'anna', 1)")
    as_release(db, speakers=4)
    memory = SpeakerMemoryService(db_path=str(db), photos_dir=tmp_path / "p")
    assert memory.get_color_index("s1") == 2
    assert memory.get_handle("s1") == "anna"
    assert memory.get_photo("s1") is None
    memory.set_photo("s1", JPEG, "image/jpeg")
    assert user_version(db) == LATEST
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT color_index, handle, handle_manual FROM speaker_meta").fetchone() == (2, "anna", 1)


# ── API ───────────────────────────────────────────────────────────────────────

@pytest.fixture
def client(tmp_path, photos):
    db = str(tmp_path / "sonorus.db")
    shared = SpeakerMemoryService(db_path=db, photos_dir=photos)
    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(db_path=db)
    app.dependency_overrides[get_memory_service] = lambda: shared
    yield TestClient(app)
    app.dependency_overrides.clear()


def _memory():
    return app.dependency_overrides[get_memory_service]()


def _put(client, spk, data=JPEG, mime="image/jpeg"):
    return client.put(f"/speakers/{spk}/photo", content=data, headers={"Content-Type": mime})


def test_put_photo_returns_the_speaker_with_it(client, photos):
    spk = _memory().create_named_speaker("Anna")
    r = _put(client, spk)
    assert r.status_code == 200
    photo = r.json()["photo"]
    assert _files(photos) == [photo]
    row = next(row for row in client.get("/speakers").json() if row["id"] == spk)
    assert row["photo"] == photo


def test_get_photo_serves_the_file(client):
    spk = _memory().create_named_speaker("Anna")
    photo = _put(client, spk, PNG, "image/png").json()["photo"]
    r = client.get(f"/speakers/{spk}/photo?v={photo}")
    assert r.status_code == 200
    assert r.content == PNG
    assert r.headers["content-type"] == "image/png"


def test_get_photo_without_one_is_404(client):
    spk = _memory().create_named_speaker("Anna")
    assert client.get(f"/speakers/{spk}/photo").status_code == 404


def test_delete_photo(client, photos):
    spk = _memory().create_named_speaker("Anna")
    _put(client, spk)
    r = client.delete(f"/speakers/{spk}/photo")
    assert r.status_code == 200
    assert r.json()["photo"] is None
    assert _files(photos) == []
    assert client.get(f"/speakers/{spk}/photo").status_code == 404


def test_put_photo_refusals(client, photos):
    spk = _memory().create_named_speaker("Anna")
    assert _put(client, spk, b"GIF89a", "image/gif").status_code == 415
    assert _put(client, spk, PNG, "image/jpeg").status_code == 415
    assert _put(client, spk, JPEG + b"\x00" * MAX_PHOTO_BYTES).status_code == 413
    assert _put(client, str(uuid_module.uuid4())).status_code == 404
    assert _files(photos) == []


def test_put_photo_for_an_unnamed_speaker_is_refused(client, photos):
    spk = str(uuid_module.uuid4())
    memory = _memory()
    memory.update_embedding(spk, np.ones(3, dtype=np.float32))
    memory.save()
    r = _put(client, spk)
    assert r.status_code == 400
    assert r.json()["code"] == "photo_needs_name"
    assert _files(photos) == []


def test_delete_speaker_route_deletes_the_photo(client, photos):
    spk = _memory().create_named_speaker("Anna")
    _put(client, spk)
    assert client.delete(f"/speakers/{spk}").status_code == 200
    assert _files(photos) == []


def test_undoing_a_new_speaker_deletes_their_photo(client, photos):
    storage = app.dependency_overrides[get_storage_service]()
    voice = str(uuid_module.uuid4())
    tid = storage.save(Transcript(audio_path="files/test.wav", language="en", segments=[
        Segment(0.0, 1.0, "Hi", "SPEAKER_00", speaker_resolved=voice,
                embedding=np.array([1.0, 0.0, 0.0], dtype=np.float32)),
    ]))
    r = client.post(f"/transcripts/{tid}/speaker-assignments", json={"speaker_name": "Anna", "segment_starts": [0.0]})
    assert r.status_code == 200, r.text
    created = r.json()["speaker_id"]
    assert _put(client, created).status_code == 200
    r = client.post(f"/transcripts/{tid}/speaker-assignments/undo",
                    json={"segment_starts": [0.0], "speaker_id": voice, "created_speaker_id": created})
    assert r.status_code in (200, 204), r.text
    assert _files(photos) == []


class _IdleCapture:
    def is_recording(self) -> bool:
        return False


def test_reset_deletes_every_photo(client, tmp_path, photos, monkeypatch):
    import app.config as config
    monkeypatch.setattr(config, "RECORDINGS_DIR", tmp_path / "recordings")
    monkeypatch.setattr(config, "SPEAKER_PHOTOS_DIR", photos)
    app.dependency_overrides[get_live_recording_service] = lambda: _IdleCapture()
    spk = _memory().create_named_speaker("Anna")
    _put(client, spk)
    save_photo(PNG, "image/png", photos)  # an orphan goes too
    assert client.post("/data/reset").status_code == 200
    assert _files(photos) == []
    assert _memory().get_photo(spk) is None
