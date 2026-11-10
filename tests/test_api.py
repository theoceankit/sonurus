"""
API tests — REST endpoints for transcripts and speakers.
The transcription queue (/queue, /ws/queue) is tested in test_queue_api.py
because it runs the ML pipeline.
"""
import uuid as uuid_module

import numpy as np
import pytest
from fastapi.testclient import TestClient


def _is_valid_uuid(value: str) -> bool:
    """Return True if value is a valid UUID (any version)."""
    try:
        uuid_module.UUID(value)
        return True
    except ValueError:
        return False

from app.api.main import app
from app.api.dependencies import get_memory_service, get_storage_service
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.commit_service import CommitService
from app.models.transcript import Transcript
from app.models.segment import Segment


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def client(tmp_path):
    transcript_db = str(tmp_path / "transcripts.db")
    memory_db     = str(tmp_path / "memory.db")

    def _storage():
        return TranscriptStorageService(db_path=transcript_db)

    def _memory():
        return SpeakerMemoryService(db_path=memory_db)

    app.dependency_overrides[get_storage_service] = _storage
    app.dependency_overrides[get_memory_service]  = _memory

    yield TestClient(app)

    app.dependency_overrides.clear()


def _make_transcript(audio_path="files/test.wav", language="en"):
    return Transcript(
        audio_path=audio_path,
        language=language,
        segments=[
            Segment(0.0, 2.0, "Hello", "SPEAKER_00", speaker_resolved="Alice"),
            Segment(2.0, 4.0, "World", "SPEAKER_01", speaker_resolved="Bob"),
        ],
    )


def _saved_id(client) -> int:
    """Save one transcript and return its db_id."""
    storage = app.dependency_overrides[get_storage_service]()
    t = _make_transcript()
    return storage.save(t)


# ── Health ────────────────────────────────────────────────────────────────────

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_health_reports_whose_backend_it_is(client, monkeypatch, tmp_path):
    # Electron reuses a backend already on :8000 only if it serves the same
    # data dir (packaged app) or is not the packaged app's (dev).
    import app.config as config
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.delenv("SONORUS_PACKAGED", raising=False)
    import os
    assert client.get("/health").json() == {
        "status": "ok", "data_dir": str(tmp_path), "packaged": False, "pid": os.getpid(),
    }

    monkeypatch.setenv("SONORUS_PACKAGED", "1")
    assert client.get("/health").json()["packaged"] is True


def test_data_dir_is_absolute():
    import app.config as config
    assert config.DATA_DIR.is_absolute()
    assert config.RECORDINGS_DIR == config.DATA_DIR / "recordings"


# ── Transcripts list ──────────────────────────────────────────────────────────

def test_list_transcripts_empty(client):
    r = client.get("/transcripts")
    assert r.status_code == 200
    assert r.json() == []


def test_list_transcripts_returns_saved(client):
    _saved_id(client)
    r = client.get("/transcripts")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["title"] == "test"
    assert items[0]["status"] == "draft"


# ── Get transcript ────────────────────────────────────────────────────────────

def test_get_transcript_returns_segments(client):
    db_id = _saved_id(client)
    r = client.get(f"/transcripts/{db_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == db_id
    assert data["language"] == "en"
    assert len(data["segments"]) == 2
    assert data["segments"][0]["text"] == "Hello"
    assert data["segments"][0]["speaker_resolved"] == "Alice"


def test_get_transcript_not_found(client):
    r = client.get("/transcripts/999")
    assert r.status_code == 404


# ── Delete transcript ─────────────────────────────────────────────────────────

def test_delete_transcript(client):
    db_id = _saved_id(client)
    r = client.delete(f"/transcripts/{db_id}")
    assert r.status_code == 204
    assert client.get(f"/transcripts/{db_id}").status_code == 404
    assert client.get("/transcripts").json() == []


def test_delete_transcript_not_found(client):
    r = client.delete("/transcripts/999")
    assert r.status_code == 404


# ── Segment text ──────────────────────────────────────────────────────────────

def test_update_segment_text(client):
    db_id = _saved_id(client)
    r = client.patch(
        f"/transcripts/{db_id}/segments/0.0/text",
        json={"text": "Hi there"},
    )
    assert r.status_code == 204
    segs = client.get(f"/transcripts/{db_id}").json()["segments"]
    assert segs[0]["text"] == "Hi there"


# ── Delete segment ────────────────────────────────────────────────────────────

def test_delete_segment(client):
    db_id = _saved_id(client)
    r = client.delete(f"/transcripts/{db_id}/segments/0.0")
    assert r.status_code == 204
    segs = client.get(f"/transcripts/{db_id}").json()["segments"]
    assert len(segs) == 1
    assert segs[0]["text"] == "World"


def test_delete_segment_not_found(client):
    db_id = _saved_id(client)
    r = client.delete(f"/transcripts/{db_id}/segments/99.0")
    assert r.status_code == 404


# ── Speakers ──────────────────────────────────────────────────────────────────

def test_list_speakers_empty(client):
    r = client.get("/speakers")
    assert r.status_code == 200
    assert r.json() == []


def test_list_speakers_after_commit(client):
    memory = app.dependency_overrides[get_memory_service]()
    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    spk_id = "spk_alice01"
    memory.update_embedding(spk_id, emb)
    memory.set_name(spk_id, "Alice")
    memory.save()

    r = client.get("/speakers")
    assert r.status_code == 200
    speakers = r.json()
    assert len(speakers) == 1
    assert speakers[0]["id"] == spk_id
    assert speakers[0]["name"] == "Alice"


def test_rename_speaker(client):
    """POST /speakers/{id}/rename sets the display name for a speaker UUID."""
    memory = app.dependency_overrides[get_memory_service]()
    spk_uuid = str(uuid_module.uuid4())
    memory.update_embedding(spk_uuid, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    memory.save()

    r = client.post(f"/speakers/{spk_uuid}/rename", json={"name": "Alice Ivanova"})
    assert r.status_code == 204

    memory2 = app.dependency_overrides[get_memory_service]()
    assert memory2.get_name(spk_uuid) == "Alice Ivanova"


def test_rename_speaker_not_found(client):
    r = client.post("/speakers/ghost/rename", json={"name": "Ghost"})
    assert r.status_code == 404


def _client_with_shared_memory(tmp_path):
    """
    Return (TestClient, memory_instance) where the same SpeakerMemoryService
    instance is injected into the app for every request — matching the
    production lru_cache(maxsize=1) behaviour.  This matters for rename tests:
    the router must operate on the same long-lived instance that CommitService
    would have mutated, not a freshly DB-loaded one.
    """
    transcript_db = str(tmp_path / "transcripts2.db")
    memory_db     = str(tmp_path / "memory2.db")

    storage = TranscriptStorageService(db_path=transcript_db)
    memory  = SpeakerMemoryService(db_path=memory_db)

    app.dependency_overrides[get_storage_service] = lambda: storage
    app.dependency_overrides[get_memory_service]  = lambda: memory

    tc = TestClient(app)
    return tc, memory


def test_rename_does_not_change_embedding(tmp_path):
    """POST /speakers/{id}/rename must not touch the embedding blob in
    speaker_embeddings.

    Uses a shared (long-lived) memory instance to mirror production behaviour.
    After the initial save(), update_embedding() is called again on the shared
    instance (simulating a concurrent commit that bumped the in-memory
    embedding to a new value).  The rename call must NOT flush this drifted
    in-memory state back to speaker_embeddings — only speaker_names should
    be written.  Verified by comparing the raw embedding blob in the DB before
    and after rename.
    """
    import sqlite3 as _sqlite3

    tc, memory = _client_with_shared_memory(tmp_path)
    try:
        emb_v1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        memory.update_embedding("spk_aaa", emb_v1)
        memory.save()

        db_path = memory.db_path

        def _read_blob():
            with _sqlite3.connect(db_path) as conn:
                row = conn.execute(
                    "SELECT embedding FROM speaker_embeddings WHERE id = ?",
                    ("spk_aaa",),
                ).fetchone()
            return row[0] if row else None

        blob_before = _read_blob()
        assert blob_before is not None

        # Simulate CommitService running on the same instance: embedding drifts.
        emb_v2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)
        memory.update_embedding("spk_aaa", emb_v2)
        # Do NOT call memory.save() — only CommitService is allowed to do that.
        # Now memory.known_speakers["spk_aaa"] differs from what is in the DB.

        r = tc.post("/speakers/spk_aaa/rename", json={"name": "Alice"})
        assert r.status_code == 204

        blob_after = _read_blob()
        assert blob_after is not None, "Speaker row disappeared after rename"
        assert blob_before == blob_after, (
            "rename must not overwrite the embedding blob in speaker_embeddings; "
            "use save_names_only() instead of save()"
        )
    finally:
        app.dependency_overrides.clear()


def test_rename_does_not_inflate_count(tmp_path):
    """POST /speakers/{id}/rename must not touch the count column in
    speaker_embeddings.

    Uses a shared (long-lived) memory instance to mirror production behaviour.
    After the initial save() (count=1 in DB), update_embedding() is called
    again on the shared instance, bumping the in-memory count to 2.  The rename
    call must NOT flush this inflated count back to the DB — only speaker_names
    should be written.  Verified by reading count directly from SQLite.
    """
    import sqlite3 as _sqlite3

    tc, memory = _client_with_shared_memory(tmp_path)
    try:
        emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        memory.update_embedding("spk_aaa", emb)
        memory.save()  # DB: count=1

        db_path = memory.db_path

        # Simulate a second CommitService call on the same instance: count→2.
        emb2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)
        memory.update_embedding("spk_aaa", emb2)
        # memory.known_counts["spk_aaa"] is now 2; DB still has 1.

        r = tc.post("/speakers/spk_aaa/rename", json={"name": "Alice"})
        assert r.status_code == 204

        with _sqlite3.connect(db_path) as conn:
            row = conn.execute(
                "SELECT count FROM speaker_embeddings WHERE id = ?",
                ("spk_aaa",),
            ).fetchone()

        assert row is not None, "Speaker row disappeared after rename"
        assert row[0] == 1, (
            f"rename must not touch speaker_embeddings; expected count=1 "
            f"(unchanged from initial save), got {row[0]}. "
            f"The router likely called save() which flushed the inflated "
            f"in-memory count. Use save_names_only() instead."
        )
    finally:
        app.dependency_overrides.clear()


# ── Deleting audio must be reflected in speaker memory (invariant I4) ────────

_ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_BOB   = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


def _emb(*v):
    return np.array(v, dtype=np.float32)


def _setup_two_transcripts():
    """t1: Alice. t2: Alice (different voice sample) + unnamed Bob (only here)."""
    from app.services.commit_service import CommitService
    storage = app.dependency_overrides[get_storage_service]()
    memory  = app.dependency_overrides[get_memory_service]()
    t1 = Transcript(audio_path="a.wav", segments=[
        Segment(0.0, 2.0, "hi", "SPEAKER_00", speaker_resolved=_ALICE, embedding=_emb(1.0, 0.3, 0.0)),
    ])
    t2 = Transcript(audio_path="b.wav", segments=[
        Segment(0.0, 2.0, "yo", "SPEAKER_00", speaker_resolved=_ALICE, embedding=_emb(1.0, 0.0, 0.3)),
        Segment(2.0, 4.0, "hey", "SPEAKER_01", speaker_resolved=_BOB, embedding=_emb(0.0, 1.0, 0.0)),
    ])
    id1, id2 = storage.save(t1), storage.save(t2)
    commit = CommitService(memory, storage)
    commit.commit_speaker(_ALICE)
    commit.commit_speaker(_BOB)
    memory.set_name(_ALICE, "Alice")
    memory.save_names_only()
    return id1, id2


def _fresh_memory():
    return app.dependency_overrides[get_memory_service]()


def test_delete_transcript_recomputes_remaining_speaker_embedding(client):
    id1, id2 = _setup_two_transcripts()
    before = _fresh_memory().known_speakers[_ALICE].copy()

    assert client.delete(f"/transcripts/{id2}").status_code == 204

    after = _fresh_memory().known_speakers[_ALICE]
    only_t1 = _emb(1.0, 0.3, 0.0) / np.linalg.norm(_emb(1.0, 0.3, 0.0))
    assert not np.allclose(before, after), "embedding still includes the deleted transcript"
    assert np.allclose(after, only_t1, atol=1e-5)


def test_delete_transcript_removes_unnamed_speaker_with_no_segments_left(client):
    id1, id2 = _setup_two_transcripts()
    assert _BOB in _fresh_memory().known_speakers

    assert client.delete(f"/transcripts/{id2}").status_code == 204

    assert _BOB not in _fresh_memory().known_speakers


def test_delete_segment_removes_unnamed_speaker_with_no_segments_left(client):
    id1, id2 = _setup_two_transcripts()

    assert client.delete(f"/transcripts/{id2}/segments/2.0").status_code == 204

    assert _BOB not in _fresh_memory().known_speakers
    assert _ALICE in _fresh_memory().known_speakers


# ── Single-segment reassign to a NEW named speaker ───────────────────────────

# ── POST /data/reset ──────────────────────────────────────────────────────────

class _IdleCapture:
    def __init__(self, active=False):
        self.active = active

    def has_active_jobs(self) -> bool:
        return self.active


@pytest.fixture
def reset_env(client, tmp_path, monkeypatch):
    """client + isolated recordings dir + an idle capture service."""
    import app.config as config
    from app.api.dependencies import get_audio_capture_service

    recordings = tmp_path / "data" / "recordings"
    recordings.mkdir(parents=True)
    monkeypatch.setattr(config, "RECORDINGS_DIR", recordings)

    capture = _IdleCapture()
    app.dependency_overrides[get_audio_capture_service] = lambda: capture
    yield client, recordings, capture


def test_reset_deletes_transcripts_and_all_speakers(reset_env):
    client, *_ = reset_env
    _setup_two_transcripts()  # Alice is named, Bob is not
    assert _fresh_memory().known_speakers

    r = client.post("/data/reset")

    assert r.status_code == 200
    body = r.json()
    assert body["transcripts"] == 2
    assert body["speakers"] == 2
    assert client.get("/transcripts").json() == []
    assert client.get("/speakers").json() == []
    fresh = _fresh_memory()
    assert fresh.known_speakers == {}
    assert fresh.known_names == {}


def test_reset_clears_the_api_memory_singleton(reset_env):
    """The DI memory instance itself must be emptied, not only the DB."""
    client, *_ = reset_env
    shared = _fresh_memory()
    app.dependency_overrides[get_memory_service] = lambda: shared
    spk = shared.create_named_speaker("Carol")
    shared.update_embedding(spk, np.ones(3))
    shared.save()

    assert client.post("/data/reset").status_code == 200

    assert shared.known_speakers == {}
    assert shared.known_names == {}


def test_reset_deletes_recordings_and_imported_copies(reset_env):
    client, recordings, _ = reset_env
    (recordings / "sonorus-rec-1.wav").write_bytes(b"x")
    (recordings / "sonorus-import-1.mp3").write_bytes(b"x")

    r = client.post("/data/reset")

    assert r.status_code == 200
    assert r.json()["files"] == 2
    assert list(recordings.iterdir()) == []


def test_reset_deletes_waveform_levels(reset_env):
    client, recordings, _ = reset_env
    (recordings / "sonorus-rec-1.wav").write_bytes(b"x")
    (recordings / "sonorus-rec-1.wav.levels").write_bytes(b"x")

    assert client.post("/data/reset").status_code == 200

    assert list(recordings.iterdir()) == []


def test_reset_keeps_audio_files_outside_data_dir(reset_env, tmp_path):
    client, recordings, _ = reset_env
    outside = tmp_path / "imported" / "interview.wav"
    outside.parent.mkdir()
    outside.write_bytes(b"audio")
    _storage = app.dependency_overrides[get_storage_service]()
    _storage.save(_make_transcript(audio_path=str(outside)))
    (recordings / "link.wav").symlink_to(outside)

    assert client.post("/data/reset").status_code == 200

    assert outside.read_bytes() == b"audio"
    assert not (recordings / "link.wav").exists()
    assert not (recordings / "link.wav").is_symlink()


def test_reset_on_empty_data_succeeds(reset_env):
    client, *_ = reset_env
    r = client.post("/data/reset")
    assert r.status_code == 200
    assert r.json() == {"transcripts": 0, "speakers": 0, "files": 0}


def test_reset_works_when_data_dirs_do_not_exist(reset_env):
    client, recordings, _ = reset_env
    recordings.rmdir()
    assert client.post("/data/reset").status_code == 200


class _BusyQueue:
    """A queue whose job is running right now."""

    def is_running(self):
        return True

    def hold(self):
        from app.services.transcription_queue import QueueBusy
        raise QueueBusy()


def test_reset_returns_409_while_transcription_job_runs(reset_env):
    from app.api.dependencies import get_transcription_queue
    client, *_ = reset_env
    _setup_two_transcripts()
    app.dependency_overrides[get_transcription_queue] = lambda: _BusyQueue()

    r = client.post("/data/reset")

    assert r.status_code == 409
    assert len(client.get("/transcripts").json()) == 2


def test_reset_returns_409_while_audio_capture_runs(reset_env):
    client, recordings, capture = reset_env
    _setup_two_transcripts()
    (recordings / "sonorus-rec-1.wav").write_bytes(b"x")
    capture.active = True

    r = client.post("/data/reset")

    assert r.status_code == 409
    assert len(client.get("/transcripts").json()) == 2
    assert (recordings / "sonorus-rec-1.wav").exists()


# ── DELETE /transcripts/{id} — app-owned audio ────────────────────────────────

@pytest.fixture
def recordings_dir(tmp_path, monkeypatch):
    import app.config as config
    d = tmp_path / "data" / "recordings"
    d.mkdir(parents=True)
    monkeypatch.setattr(config, "RECORDINGS_DIR", d)
    return d


def _save(audio_path):
    storage = app.dependency_overrides[get_storage_service]()
    return storage.save(_make_transcript(audio_path=str(audio_path)))


def test_delete_transcript_removes_its_live_recording(client, recordings_dir):
    rec = recordings_dir / "sonorus-rec-1.wav"
    rec.write_bytes(b"x")
    tid = _save(rec)

    assert client.delete(f"/transcripts/{tid}").status_code == 204

    assert not rec.exists()


def test_delete_transcript_removes_the_waveform_levels_of_its_recording(client, recordings_dir):
    rec = recordings_dir / "sonorus-import-1.mp3"
    rec.write_bytes(b"x")
    levels = recordings_dir / "sonorus-import-1.mp3.levels"
    levels.write_bytes(b"x")
    tid = _save(rec)

    assert client.delete(f"/transcripts/{tid}").status_code == 204

    assert not levels.exists()


def test_delete_transcript_keeps_levels_of_a_recording_still_used(client, recordings_dir):
    rec = recordings_dir / "sonorus-rec-1.wav"
    rec.write_bytes(b"x")
    levels = recordings_dir / "sonorus-rec-1.wav.levels"
    levels.write_bytes(b"x")
    tid = _save(rec)
    _save(rec)

    assert client.delete(f"/transcripts/{tid}").status_code == 204

    assert levels.exists()


def test_delete_transcript_keeps_imported_file_outside_data_dir(client, recordings_dir, tmp_path):
    imported = tmp_path / "imported" / "talk.wav"
    imported.parent.mkdir()
    imported.write_bytes(b"x")
    tid = _save(imported)

    assert client.delete(f"/transcripts/{tid}").status_code == 204

    assert imported.exists()


def test_delete_transcript_keeps_recording_still_used_by_another(client, recordings_dir):
    rec = recordings_dir / "sonorus-rec-1.wav"
    rec.write_bytes(b"x")
    tid = _save(rec)
    _save(rec)

    assert client.delete(f"/transcripts/{tid}").status_code == 204

    assert rec.exists()


def test_delete_transcript_ignores_path_escaping_recordings_dir(client, recordings_dir, tmp_path):
    outside = tmp_path / "data" / "secret.wav"
    outside.write_bytes(b"x")
    tid = _save(recordings_dir / ".." / "secret.wav")

    assert client.delete(f"/transcripts/{tid}").status_code == 204

    assert outside.exists()


def test_delete_transcript_keeps_symlink_target(client, recordings_dir, tmp_path):
    target = tmp_path / "imported.wav"
    target.write_bytes(b"x")
    link = recordings_dir / "link.wav"
    link.symlink_to(target)
    tid = _save(link)

    assert client.delete(f"/transcripts/{tid}").status_code == 204

    assert target.exists()


def test_delete_transcript_with_missing_recording_succeeds(client, recordings_dir):
    tid = _save(recordings_dir / "gone.wav")
    assert client.delete(f"/transcripts/{tid}").status_code == 204
    assert client.get(f"/transcripts/{tid}").status_code == 404


def test_delete_unknown_transcript_returns_404(client, recordings_dir):
    assert client.delete("/transcripts/9999").status_code == 404


# ── Speakers section: list, update, delete, transcripts ──────────────────────

_BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
_CAROL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
_DAVE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"


def _speakers_fixture():
    """Alice: named, voice, 2 segments in 2 transcripts. Bob: unnamed, voice,
    1 segment. Carol: in segments only (no profile, no name)."""
    storage = app.dependency_overrides[get_storage_service]()
    memory = app.dependency_overrides[get_memory_service]()
    first = storage.save(Transcript(audio_path="first.wav", segments=[
        Segment(0.0, 2.0, "a", "SPEAKER_00", speaker_resolved=_ALICE, embedding=_emb(1.0, 0.0, 0.0)),
        Segment(2.0, 3.0, "b", "SPEAKER_01", speaker_resolved=_BOB, embedding=_emb(0.0, 1.0, 0.0)),
        Segment(3.0, 4.0, "c", "SPEAKER_02", speaker_resolved=_CAROL),
    ]))
    second = storage.save(Transcript(audio_path="second.wav", segments=[
        Segment(0.0, 1.5, "d", "SPEAKER_00", speaker_resolved=_ALICE, embedding=_emb(1.0, 0.1, 0.0)),
    ]))
    memory.update_embedding(_ALICE, _emb(1.0, 0.0, 0.0))
    memory.update_embedding(_BOB, _emb(0.0, 1.0, 0.0))
    memory.set_name(_ALICE, "Alice")
    memory.save()
    return first, second


def _speaker_rows(client):
    r = client.get("/speakers")
    assert r.status_code == 200, r.text
    return {row["id"]: row for row in r.json()}


def test_list_speakers_includes_unnamed_and_segment_only_speakers(client):
    _speakers_fixture()
    rows = _speaker_rows(client)
    assert set(rows) == {_ALICE, _BOB, _CAROL}
    assert rows[_ALICE]["name"] == "Alice"
    assert rows[_BOB]["name"] is None
    assert rows[_CAROL]["name"] is None


def test_list_speakers_reports_usage_statistics(client):
    _speakers_fixture()
    alice = _speaker_rows(client)[_ALICE]
    assert alice["segments"] == 2
    assert alice["transcripts"] == 2
    assert alice["duration_sec"] == pytest.approx(3.5)
    assert alice["last_seen"]


def test_list_speakers_puts_named_first(client):
    _speakers_fixture()
    ids = [row["id"] for row in client.get("/speakers").json()]
    assert ids[0] == _ALICE


def _set_created_at(transcript_id, created_at):
    storage = app.dependency_overrides[get_storage_service]()
    with storage._connect() as conn:
        conn.execute("UPDATE transcriptions SET created_at = ? WHERE id = ?", (created_at, transcript_id))


def test_list_speakers_orders_same_names_by_last_seen_then_id(client):
    """Speakers sharing a name keep one order: most recently seen first, then by id."""
    first, second = _speakers_fixture()
    third = app.dependency_overrides[get_storage_service]().save(Transcript(audio_path="third.wav", segments=[
        Segment(0.0, 1.0, "e", "SPEAKER_00", speaker_resolved=_DAVE),
    ]))
    memory = app.dependency_overrides[get_memory_service]()
    memory.set_name(_BOB, " alice")
    memory.set_name(_CAROL, "ALICE ")
    memory.set_name(_DAVE, "Alice")
    memory.save_names_only()
    _set_created_at(first, "2026-01-01T10:00:00")   # Bob, Carol; Alice too
    _set_created_at(second, "2026-03-01T10:00:00")  # Alice's latest
    _set_created_at(third, "2026-02-01T10:00:00")   # Dave

    expected = [_ALICE, _DAVE] + sorted([_BOB, _CAROL])
    for _ in range(3):
        assert [row["id"] for row in client.get("/speakers").json()] == expected


def test_list_speakers_orders_unnamed_with_equal_last_seen_by_id(client):
    _speakers_fixture()
    ids = [row["id"] for row in client.get("/speakers").json()]
    assert ids == [_ALICE] + sorted([_BOB, _CAROL])


def test_patch_speaker_renames_and_recolors(client):
    _speakers_fixture()
    r = client.patch(f"/speakers/{_BOB}", json={"name": "  Bob  ", "color_index": 2})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Bob" and r.json()["color_index"] == 2
    row = _speaker_rows(client)[_BOB]
    assert row["name"] == "Bob" and row["color_index"] == 2


def test_patch_speaker_can_name_a_segment_only_speaker(client):
    _speakers_fixture()
    assert client.patch(f"/speakers/{_CAROL}", json={"name": "Carol"}).status_code == 200
    assert _speaker_rows(client)[_CAROL]["name"] == "Carol"


def test_patch_speaker_allows_a_name_another_speaker_has(client):
    """Names are labels, not identities: two people named Alice are two UUIDs."""
    _speakers_fixture()
    r = client.patch(f"/speakers/{_BOB}", json={"name": "Alice"})
    assert r.status_code == 200, r.text
    rows = _speaker_rows(client)
    assert rows[_BOB]["name"] == "Alice" and rows[_ALICE]["name"] == "Alice"


def test_patch_speaker_keeping_own_name_is_allowed(client):
    _speakers_fixture()
    assert client.patch(f"/speakers/{_ALICE}", json={"name": "ALICE"}).status_code == 200


@pytest.mark.parametrize("body", [{}, {"color_index": 5}, {"color_index": -1}, {"name": "   "}])
def test_patch_speaker_rejects_invalid_body(client, body):
    _speakers_fixture()
    assert client.patch(f"/speakers/{_ALICE}", json=body).status_code in (400, 422)


def test_patch_unknown_speaker_returns_404(client):
    assert client.patch(f"/speakers/{_BOB}", json={"name": "X"}).status_code == 404


def test_rename_allows_a_name_another_speaker_has(client):
    _speakers_fixture()
    assert client.post(f"/speakers/{_BOB}/rename", json={"name": "Alice"}).status_code == 204


def test_speaker_transcripts(client):
    first, second = _speakers_fixture()
    r = client.get(f"/speakers/{_ALICE}/transcripts")
    assert r.status_code == 200
    assert {t["id"] for t in r.json()} == {first, second}
    assert client.get(f"/speakers/{_BOB}/transcripts").json()[0]["title"] == "first"


def test_speaker_transcripts_tell_whether_the_audio_is_there(client, tmp_path):
    storage = app.dependency_overrides[get_storage_service]()
    present = tmp_path / "present.wav"
    present.write_bytes(b"RIFF")
    with_audio = storage.save(Transcript(audio_path=str(present), segments=[
        Segment(0.0, 1.0, "a", "SPEAKER_00", speaker_resolved=_ALICE),
    ]))
    without_audio = storage.save(Transcript(audio_path=str(tmp_path / "gone.wav"), segments=[
        Segment(0.0, 1.0, "b", "SPEAKER_00", speaker_resolved=_ALICE),
    ]))
    rows = {t["id"]: t for t in client.get(f"/speakers/{_ALICE}/transcripts").json()}
    assert rows[with_audio]["has_audio"] is True
    assert rows[without_audio]["has_audio"] is False


def test_speaker_transcripts_unknown_returns_404(client):
    assert client.get(f"/speakers/{_BOB}/transcripts").status_code == 404


def test_delete_speaker_unassigns_segments(reset_env):
    client, *_ = reset_env
    first, second = _speakers_fixture()

    r = client.delete(f"/speakers/{_ALICE}")

    assert r.status_code == 200, r.text
    assert r.json() == {"segments": 2, "transcripts": 2}
    assert _ALICE not in _speaker_rows(client)
    segs = client.get(f"/transcripts/{first}").json()["segments"]
    assert segs[0]["unassigned"] is True
    assert segs[0]["speaker_resolved"] is None and segs[0]["speaker_final"] is None
    assert segs[1]["unassigned"] is False
    assert _ALICE not in _fresh_memory().known_speakers


def test_delete_unknown_speaker_returns_404(reset_env):
    client, *_ = reset_env
    assert client.delete(f"/speakers/{_ALICE}").status_code == 404


def test_delete_speaker_returns_409_while_transcription_runs(reset_env):
    from app.api.dependencies import get_transcription_queue
    client, *_ = reset_env
    _speakers_fixture()
    app.dependency_overrides[get_transcription_queue] = lambda: _BusyQueue()
    assert client.delete(f"/speakers/{_ALICE}").status_code == 409
    assert _ALICE in _speaker_rows(client)


def test_delete_speaker_returns_409_while_capture_runs(reset_env):
    client, _, capture = reset_env
    _speakers_fixture()
    capture.active = True
    assert client.delete(f"/speakers/{_ALICE}").status_code == 409


_DAN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
_ERIN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
_FRANK = "ffffffff-ffff-4fff-8fff-ffffffffffff"


def _named_profiles(profiles):
    """profiles: {speaker id: (name, embedding)}."""
    memory = app.dependency_overrides[get_memory_service]()
    for spk_id, (name, embedding) in profiles.items():
        memory.update_embedding(spk_id, embedding)
        memory.set_name(spk_id, name)
    memory.save()
    return memory


def _alice_carol_dan():
    return _named_profiles({
        _ALICE: ("Alice", _emb(0.6, 0.8, 0.0)),
        _CAROL: ("Carol", _emb(0.0, 1.0, 0.0)),
        _DAN: ("Dan", _emb(0.8, 0.6, 0.0)),
    })


def _save_voice(segments, audio_path="a.wav"):
    storage = app.dependency_overrides[get_storage_service]()
    return storage.save(Transcript(audio_path=str(audio_path), segments=segments))


def test_candidates_are_sorted_and_at_most_three(client):
    _alice_carol_dan()
    _named_profiles({_ERIN: ("Erin", _emb(-1.0, 0.0, 0.0))})
    transcript_id = _save_voice([
        Segment(0.0, 2.0, "a", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(1.0, 0.0, 0.0)),
    ])
    r = client.get(f"/transcripts/{transcript_id}/speaker-candidates")
    assert r.status_code == 200, r.text
    assert r.json()[_BOB]["candidates"] == [
        {"speaker_id": _DAN, "name": "Dan", "score": 0.8, "suggested": True},
        {"speaker_id": _ALICE, "name": "Alice", "score": 0.6, "suggested": False},
        {"speaker_id": _CAROL, "name": "Carol", "score": 0.0, "suggested": False},
    ]


def test_candidates_compare_the_voice_of_all_segments_of_the_speaker(client):
    _named_profiles({_ALICE: ("Alice", _emb(1.0, 1.0, 0.0))})
    transcript_id = _save_voice([
        Segment(0.0, 2.0, "a", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(1.0, 0.0, 0.0)),
        Segment(2.0, 4.0, "b", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(0.0, 1.0, 0.0)),
    ])
    candidates = client.get(f"/transcripts/{transcript_id}/speaker-candidates").json()[_BOB]["candidates"]
    assert candidates[0]["score"] == 1.0


def test_candidates_only_for_speakers_without_a_name(client):
    _alice_carol_dan()
    transcript_id = _save_voice([
        Segment(0.0, 2.0, "a", "SPEAKER_00", speaker_resolved=_ALICE, embedding=_emb(0.6, 0.8, 0.0)),
    ])
    r = client.get(f"/transcripts/{transcript_id}/speaker-candidates")
    assert r.status_code == 200
    assert r.json() == {}


def test_candidates_treat_a_named_speaker_without_a_voice_as_known(client):
    memory = app.dependency_overrides[get_memory_service]()
    memory.set_name(_ALICE, "Alice")
    memory.save_names_only()
    transcript_id = _save_voice([Segment(0.0, 2.0, "a", "SPEAKER_00", speaker_resolved=_ALICE)])
    assert client.get(f"/transcripts/{transcript_id}/speaker-candidates").json() == {}


def test_candidates_never_offer_a_named_speaker_without_a_voice(client):
    memory = _named_profiles({_ALICE: ("Alice", _emb(1.0, 0.0, 0.0))})
    memory.set_name(_CAROL, "Carol")
    memory.save_names_only()
    transcript_id = _save_voice([
        Segment(0.0, 2.0, "a", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(1.0, 0.0, 0.0)),
    ])
    candidates = client.get(f"/transcripts/{transcript_id}/speaker-candidates").json()[_BOB]["candidates"]
    assert [c["speaker_id"] for c in candidates] == [_ALICE]


def test_candidates_never_offer_a_speaker_without_a_name(client):
    memory = app.dependency_overrides[get_memory_service]()
    memory.update_embedding(_CAROL, _emb(1.0, 0.0, 0.0))
    memory.save()
    transcript_id = _save_voice([
        Segment(0.0, 2.0, "a", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(1.0, 0.0, 0.0)),
    ])
    assert client.get(f"/transcripts/{transcript_id}/speaker-candidates").json()[_BOB]["candidates"] == []


def test_candidates_offer_both_speakers_with_a_shared_name(client):
    _named_profiles({_ALICE: ("Sam", _emb(1.0, 0.0, 0.0)), _CAROL: ("Sam", _emb(0.8, 0.6, 0.0))})
    transcript_id = _save_voice([
        Segment(0.0, 2.0, "a", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(1.0, 0.0, 0.0)),
    ])
    candidates = client.get(f"/transcripts/{transcript_id}/speaker-candidates").json()[_BOB]["candidates"]
    assert [(c["speaker_id"], c["name"]) for c in candidates] == [(_ALICE, "Sam"), (_CAROL, "Sam")]


def test_candidates_skip_unassigned_segments(reset_env):
    client, *_ = reset_env
    first, _ = _speakers_fixture()
    client.delete(f"/speakers/{_ALICE}")
    r = client.get(f"/transcripts/{first}/speaker-candidates")
    assert r.status_code == 200
    assert "UNASSIGNED" not in r.json()


def test_candidates_404_for_an_unknown_transcript(client):
    r = client.get("/transcripts/999/speaker-candidates")
    assert r.status_code == 404


def test_candidates_with_no_named_speaker_still_give_the_clip(client, tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")
    transcript_id = _save_voice([
        Segment(1.0, 4.0, "first recording", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(1.0, 0.0, 0.0)),
    ], audio)
    assert client.get(f"/transcripts/{transcript_id}/speaker-candidates").json() == {
        _BOB: {"candidates": [], "clip": {"start": 1.0, "end": 4.0, "text": "first recording"}},
    }


def test_candidates_clip_of_a_voice_with_no_embeddings_is_the_longest_segment(client, tmp_path):
    _alice_carol_dan()
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")
    transcript_id = _save_voice([
        Segment(0.0, 2.5, "short", "SPEAKER_00", speaker_resolved=_BOB),
        Segment(3.0, 7.0, "long", "SPEAKER_00", speaker_resolved=_BOB),
    ], audio)
    assert client.get(f"/transcripts/{transcript_id}/speaker-candidates").json() == {
        _BOB: {"candidates": [], "clip": {"start": 3.0, "end": 7.0, "text": "long"}},
    }


def test_candidates_clip_is_the_segment_closest_to_the_voice(client, tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")
    transcript_id = _save_voice([
        # The longest one holds another voice, the closest one is too short to hear.
        Segment(0.0, 20.0, "long and mixed", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(0.3, 1.0, 0.0)),
        Segment(20.0, 21.0, "too short", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(1.0, 0.0, 0.0)),
        Segment(21.0, 24.0, "typical", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(1.0, 0.2, 0.0)),
        Segment(24.0, 27.0, "typical too", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(1.0, 0.1, 0.0)),
        Segment(27.0, 30.0, "typical three", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(1.0, 0.1, 0.0)),
    ], audio)
    clip = client.get(f"/transcripts/{transcript_id}/speaker-candidates").json()[_BOB]["clip"]
    assert clip["text"].startswith("typical")


def test_candidates_clip_comes_from_this_transcript_only(client, tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")
    other = _save_voice([
        Segment(0.0, 30.0, "other recording", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(1.0, 0.0, 0.0)),
    ], audio)
    transcript_id = _save_voice([
        Segment(0.0, 3.0, "this recording", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(1.0, 0.0, 0.0)),
    ], audio)
    assert other != transcript_id
    clip = client.get(f"/transcripts/{transcript_id}/speaker-candidates").json()[_BOB]["clip"]
    assert clip["text"] == "this recording"


def test_candidates_clip_is_null_when_the_audio_is_gone(client, tmp_path):
    _alice_carol_dan()
    transcript_id = _save_voice([
        Segment(0.0, 3.0, "a", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(1.0, 0.0, 0.0)),
    ], tmp_path / "gone.wav")
    entry = client.get(f"/transcripts/{transcript_id}/speaker-candidates").json()[_BOB]
    assert entry["clip"] is None
    assert len(entry["candidates"]) == 3


def test_candidates_do_not_change_speaker_memory(client):
    import sqlite3

    memory = _alice_carol_dan()

    def stored():
        with sqlite3.connect(memory.db_path) as conn:
            return (conn.execute("SELECT id, embedding, count FROM speaker_embeddings ORDER BY id").fetchall(),
                    conn.execute("SELECT speaker_id, label, name FROM speaker_names ORDER BY speaker_id").fetchall())

    transcript_id = _save_voice([
        Segment(0.0, 2.0, "a", "SPEAKER_00", speaker_resolved=_BOB, embedding=_emb(1.0, 0.0, 0.0)),
    ])
    before = stored()
    assert client.get(f"/transcripts/{transcript_id}/speaker-candidates").status_code == 200
    assert stored() == before


# ── GET /speakers/{id}/sample ─────────────────────────────────────────────────

def _sample_fixture(tmp_path):
    """Alice speaks in two transcripts; both audio files exist."""
    storage = app.dependency_overrides[get_storage_service]()
    memory = app.dependency_overrides[get_memory_service]()
    audio1, audio2 = tmp_path / "one.wav", tmp_path / "two.wav"
    audio1.write_bytes(b"x")
    audio2.write_bytes(b"x")
    first = storage.save(Transcript(audio_path=str(audio1), segments=[
        Segment(0.0, 3.0, "far voice", "SPEAKER_00", speaker_resolved=_ALICE, embedding=_emb(0.0, 1.0, 0.0)),
        Segment(3.0, 6.0, "typical voice", "SPEAKER_00", speaker_resolved=_ALICE, embedding=_emb(1.0, 0.0, 0.0)),
    ]))
    second = storage.save(Transcript(audio_path=str(audio2), segments=[
        Segment(0.0, 2.5, "other day", "SPEAKER_00", speaker_resolved=_ALICE, embedding=_emb(0.0, 1.0, 0.0)),
    ]))
    memory.update_embedding(_ALICE, _emb(1.0, 0.0, 0.0))
    memory.set_name(_ALICE, "Alice")
    memory.save()
    return first, second, audio1, audio2


def test_speaker_sample_is_the_most_typical_segment(client, tmp_path):
    first, _, audio1, _ = _sample_fixture(tmp_path)
    r = client.get(f"/speakers/{_ALICE}/sample")
    assert r.status_code == 200, r.text
    assert r.json() == {"transcript_id": first, "audio_path": str(audio1),
                        "start": 3.0, "end": 6.0, "text": "typical voice"}


def test_speaker_sample_limited_to_one_transcript(client, tmp_path):
    _, second, _, _ = _sample_fixture(tmp_path)
    r = client.get(f"/speakers/{_ALICE}/sample", params={"transcript_id": second})
    assert r.status_code == 200
    assert r.json()["text"] == "other day"


def test_speaker_sample_skips_transcripts_without_audio(client, tmp_path):
    _, second, audio1, _ = _sample_fixture(tmp_path)
    audio1.unlink()
    assert client.get(f"/speakers/{_ALICE}/sample").json()["transcript_id"] == second


def test_speaker_sample_404_without_audio(client, tmp_path):
    _, _, audio1, audio2 = _sample_fixture(tmp_path)
    audio1.unlink()
    audio2.unlink()
    assert client.get(f"/speakers/{_ALICE}/sample").status_code == 404


def test_speaker_sample_404_for_unknown_speaker(client):
    assert client.get(f"/speakers/{_BOB}/sample").status_code == 404


# ── Transcript title ──────────────────────────────────────────────────────────

def test_patch_transcript_title_updates_get_and_list(client):
    db_id = _saved_id(client)

    r = client.patch(f"/transcripts/{db_id}", json={"title": "  Weekly sync  "})
    assert r.status_code == 204, r.text

    assert client.get(f"/transcripts/{db_id}").json()["title"] == "Weekly sync"
    listed = {row["id"]: row for row in client.get("/transcripts").json()}
    assert listed[db_id]["title"] == "Weekly sync"


def test_patch_transcript_title_unknown_id_returns_404(client):
    r = client.patch("/transcripts/999", json={"title": "Ghost"})
    assert r.status_code == 404


@pytest.mark.parametrize("title", ["", "   ", "x" * 201])
def test_patch_transcript_title_rejects_invalid(client, title):
    db_id = _saved_id(client)

    r = client.patch(f"/transcripts/{db_id}", json={"title": title})
    assert r.status_code == 422

    assert client.get(f"/transcripts/{db_id}").json()["title"] is None


def test_patch_transcript_title_missing_field_returns_422(client):
    db_id = _saved_id(client)
    assert client.patch(f"/transcripts/{db_id}", json={}).status_code == 422


# ── Transcript opened ─────────────────────────────────────────────────────────

def test_a_new_transcript_is_listed_as_not_opened(client):
    db_id = _saved_id(client)
    listed = {row["id"]: row for row in client.get("/transcripts").json()}
    assert listed[db_id]["opened"] is False


def test_get_transcript_does_not_mark_it_opened(client):
    db_id = _saved_id(client)
    assert client.get(f"/transcripts/{db_id}").status_code == 200
    assert client.get("/transcripts").json()[0]["opened"] is False


def test_post_opened_marks_the_transcript_and_can_repeat(client):
    db_id = _saved_id(client)
    other = _saved_id(client)

    assert client.post(f"/transcripts/{db_id}/opened").status_code == 204
    assert client.post(f"/transcripts/{db_id}/opened").status_code == 204

    listed = {row["id"]: row for row in client.get("/transcripts").json()}
    assert listed[db_id]["opened"] is True
    assert listed[other]["opened"] is False


def test_post_opened_unknown_id_returns_404(client):
    assert client.post("/transcripts/999/opened").status_code == 404


def test_post_opened_leaves_speaker_memory_and_segments_alone(client, monkeypatch):
    db_id = _saved_id(client)
    before = client.get(f"/transcripts/{db_id}").json()

    def no_write(*args, **kwargs):
        raise AssertionError("marking a transcript opened must not write speaker memory")
    monkeypatch.setattr(SpeakerMemoryService, "save", no_write)
    monkeypatch.setattr(SpeakerMemoryService, "update_embedding", no_write)

    assert client.post(f"/transcripts/{db_id}/opened").status_code == 204
    assert client.get(f"/transcripts/{db_id}").json() == before



def test_delete_transcript_removes_its_imported_copy(client, recordings_dir, tmp_path):
    original = tmp_path / "imported" / "interview.wav"
    original.parent.mkdir()
    original.write_bytes(b"audio")
    copy = recordings_dir / "sonorus-import-1.wav"
    copy.write_bytes(b"audio")
    tid = _save(copy)

    assert client.delete(f"/transcripts/{tid}").status_code == 204

    assert not copy.exists()
    assert original.exists()


def test_startup_removes_orphan_import_copies(tmp_path, monkeypatch):
    """Import copies nothing references are removed at startup; copies of
    transcripts and of queued jobs, and live recordings, stay."""
    import app.config as config
    import app.api.main as main_module

    recordings = tmp_path / "data" / "recordings"
    recordings.mkdir(parents=True)
    kept = recordings / "sonorus-import-kept.wav"
    queued = recordings / "sonorus-import-queued.wav"
    orphan = recordings / "sonorus-import-orphan.wav"
    live = recordings / "sonorus-rec-1.wav"
    kept_levels = recordings / "sonorus-import-kept.wav.levels"
    orphan_levels = recordings / "sonorus-import-orphan.wav.levels"
    for f in (kept, queued, orphan, live, kept_levels, orphan_levels):
        f.write_bytes(b"x")
    storage = TranscriptStorageService(db_path=str(tmp_path / "t.db"))
    storage.save(_make_transcript(audio_path=str(kept)))
    from app.services.job_store import JobStore
    from app.services.transcription_queue import TranscriptionQueue
    queue = TranscriptionQueue(JobStore(db_path=str(tmp_path / "jobs.db")), run_job=None,
                               recordings_dir=recordings)
    queue.add(audio_path=str(queued), title="q", whisper_model="small", language=None)

    monkeypatch.setattr(config, "RECORDINGS_DIR", recordings)
    monkeypatch.setattr(main_module, "get_storage_service", lambda: storage)
    monkeypatch.setattr(main_module, "get_memory_service",
                        lambda: SpeakerMemoryService(db_path=str(tmp_path / "m.db")))
    monkeypatch.setattr(main_module, "get_transcription_queue", lambda: queue)
    # Lifespan exit shuts the download executor down — keep it for later tests.
    monkeypatch.setattr(main_module.models, "shutdown_executor", lambda: None)

    with TestClient(app):
        pass

    assert kept.exists()
    assert queued.exists()
    assert live.exists()
    assert not orphan.exists()
    assert kept_levels.exists()
    assert not orphan_levels.exists(), "waveform levels go with their audio"


# ── GET /transcripts/{id}/audio ───────────────────────────────────────────────

def test_audio_returns_the_file_of_the_recording(client, tmp_path):
    audio = tmp_path / "talk.wav"
    audio.write_bytes(b"0123456789")
    res = client.get(f"/transcripts/{_save(audio)}/audio")
    assert res.status_code == 200
    assert res.content == b"0123456789"
    assert res.headers["accept-ranges"] == "bytes"


def test_audio_answers_a_range_for_seeking(client, tmp_path):
    audio = tmp_path / "talk.wav"
    audio.write_bytes(b"0123456789")
    res = client.get(f"/transcripts/{_save(audio)}/audio", headers={"Range": "bytes=2-5"})
    assert res.status_code == 206
    assert res.content == b"2345"
    assert res.headers["content-range"] == "bytes 2-5/10"


def test_audio_unknown_transcript_is_404(client):
    assert client.get("/transcripts/999/audio").status_code == 404


def test_audio_missing_file_is_404(client, tmp_path):
    assert client.get(f"/transcripts/{_save(tmp_path / 'gone.wav')}/audio").status_code == 404


def test_audio_empty_path_is_404(client):
    assert client.get(f"/transcripts/{_save('')}/audio").status_code == 404


# ── Speaker assignments ───────────────────────────────────────────────────────

def _voice(*values):
    v = np.array(values, dtype=np.float32)
    return v / np.linalg.norm(v)


def _recording(client, speakers):
    """Save segments at 0, 1, 2… seconds with the given speakers; returns the db id."""
    storage = app.dependency_overrides[get_storage_service]()
    return storage.save(Transcript(
        audio_path="files/test.wav", language="en",
        segments=[
            Segment(float(i), i + 1.0, f"Text {i}", "SPEAKER_00", speaker_resolved=spk,
                    embedding=_voice(1.0, 0.0, 0.0))
            for i, spk in enumerate(speakers)
        ],
    ))


def _speakers_of(client, db_id):
    return [s["speaker_resolved"] for s in client.get(f"/transcripts/{db_id}").json()["segments"]]


def _named(name):
    memory = app.dependency_overrides[get_memory_service]()
    return memory.create_named_speaker(name)


def test_assign_changes_only_the_listed_segments(client):
    voice, other = str(uuid_module.uuid4()), str(uuid_module.uuid4())
    alice = _named("Alice")
    db_id = _recording(client, [voice, voice, other, voice])

    r = client.post(f"/transcripts/{db_id}/speaker-assignments", json={
        "segment_starts": [0.0, 1.0], "speaker_id": alice,
    })

    assert r.status_code == 200
    assert r.json() == {"speaker_id": alice}
    assert _speakers_of(client, db_id) == [alice, alice, other, voice]


def test_assign_new_speaker_answers_its_id(client):
    voice = str(uuid_module.uuid4())
    db_id = _recording(client, [voice, voice])

    r = client.post(f"/transcripts/{db_id}/speaker-assignments", json={
        "segment_starts": [0.0, 1.0], "speaker_name": "  Dana ", "color_index": 3,
    })

    assert r.status_code == 200
    created = r.json()["speaker_id"]
    assert _speakers_of(client, db_id) == [created, created]
    row = next(s for s in client.get("/speakers").json() if s["id"] == created)
    assert (row["name"], row["color_index"]) == ("Dana", 3)


def test_assign_recomputes_both_profiles_once_and_removes_an_empty_voice(client):
    memory = app.dependency_overrides[get_memory_service]()
    voice = str(uuid_module.uuid4())
    memory.update_embedding(voice, _voice(1.0, 0.0, 0.0))
    memory.save()
    alice = _named("Alice")
    db_id = _recording(client, [voice, voice])

    client.post(f"/transcripts/{db_id}/speaker-assignments", json={"segment_starts": [0.0, 1.0], "speaker_id": alice})

    fresh = app.dependency_overrides[get_memory_service]()
    assert voice not in fresh.known_speakers
    assert fresh.known_counts[alice] == 2


def test_assign_clears_unassigned(client):
    storage = app.dependency_overrides[get_storage_service]()
    voice = str(uuid_module.uuid4())
    alice = _named("Alice")
    db_id = _recording(client, [voice, voice])
    storage.unassign_speaker(voice)

    r = client.post(f"/transcripts/{db_id}/speaker-assignments", json={"segment_starts": [0.0], "speaker_id": alice})

    assert r.status_code == 200
    segments = client.get(f"/transcripts/{db_id}").json()["segments"]
    assert [(s["speaker_resolved"], s["unassigned"]) for s in segments] == [(alice, False), (None, True)]


def test_assign_unknown_segment_changes_and_creates_nothing(client):
    voice = str(uuid_module.uuid4())
    db_id = _recording(client, [voice, voice])
    speakers_before = client.get("/speakers").json()

    r = client.post(f"/transcripts/{db_id}/speaker-assignments", json={
        "segment_starts": [0.0, 99.0], "speaker_name": "Dana",
    })

    assert r.status_code == 404
    assert _speakers_of(client, db_id) == [voice, voice]
    assert client.get("/speakers").json() == speakers_before


@pytest.mark.parametrize("body, status", [
    ({"segment_starts": [], "speaker_name": "Dana"}, 422),
    ({"segment_starts": [0.0]}, 400),
    ({"segment_starts": [0.0], "speaker_name": "Dana", "speaker_id": "x"}, 400),
    ({"segment_starts": [0.0], "speaker_id": "not-a-uuid"}, 400),
    ({"segment_starts": [0.0], "speaker_id": "11111111-1111-4111-8111-111111111111"}, 400),
    ({"segment_starts": [0.0], "speaker_name": "Dana", "color_index": 5}, 400),
])
def test_assign_rejects_a_wrong_request(client, body, status):
    voice = str(uuid_module.uuid4())
    db_id = _recording(client, [voice])
    assert client.post(f"/transcripts/{db_id}/speaker-assignments", json=body).status_code == status
    assert _speakers_of(client, db_id) == [voice]


def test_assign_color_index_with_an_existing_speaker_is_rejected(client):
    voice, alice = str(uuid_module.uuid4()), _named("Alice")
    db_id = _recording(client, [voice])
    r = client.post(f"/transcripts/{db_id}/speaker-assignments", json={
        "segment_starts": [0.0], "speaker_id": alice, "color_index": 1,
    })
    assert r.status_code == 400
    assert _speakers_of(client, db_id) == [voice]


def test_assign_out_of_palette_color_creates_no_speaker(client):
    voice = str(uuid_module.uuid4())
    db_id = _recording(client, [voice])
    r = client.post(f"/transcripts/{db_id}/speaker-assignments", json={
        "segment_starts": [0.0], "speaker_name": "Dana", "color_index": -1,
    })
    assert r.status_code == 400
    assert "Dana" not in {s["name"] for s in client.get("/speakers").json()}


def test_sequential_assignments_leave_no_ghost_speaker_and_count_once(client):
    storage = app.dependency_overrides[get_storage_service]()
    first, second = str(uuid_module.uuid4()), str(uuid_module.uuid4())
    db_id = storage.save(Transcript(audio_path="files/test.wav", language="en", segments=[
        Segment(0.0, 1.0, "Hi", "SPEAKER_00", speaker_resolved=first, embedding=_voice(1.0, 0.0, 0.0)),
        Segment(1.0, 2.0, "Bye", "SPEAKER_01", speaker_resolved=second, embedding=_voice(0.0, 1.0, 0.0)),
    ]))
    CommitService(app.dependency_overrides[get_memory_service](), storage).commit_speaker(first)

    alice = client.post(f"/transcripts/{db_id}/speaker-assignments", json={
        "segment_starts": [0.0], "speaker_name": "Alice",
    }).json()["speaker_id"]
    bob = client.post(f"/transcripts/{db_id}/speaker-assignments", json={
        "segment_starts": [1.0], "speaker_name": "Bob",
    }).json()["speaker_id"]

    memory = app.dependency_overrides[get_memory_service]()
    assert sorted(memory.known_speakers) == sorted([alice, bob])
    assert memory.known_counts[alice] == 1 and memory.known_counts[bob] == 1


def test_two_new_speakers_with_one_name_get_distinct_ids(client):
    first, second = str(uuid_module.uuid4()), str(uuid_module.uuid4())
    db_id = _recording(client, [first, second])

    ids = [
        client.post(f"/transcripts/{db_id}/speaker-assignments", json={
            "segment_starts": [start], "speaker_name": "Maria",
        }).json()["speaker_id"]
        for start in (0.0, 1.0)
    ]

    assert ids[0] != ids[1]
    assert all(_is_valid_uuid(i) for i in ids)
    assert _speakers_of(client, db_id) == ids


def test_assign_away_from_a_named_speaker_keeps_it_in_memory(client):
    memory = app.dependency_overrides[get_memory_service]()
    alex = memory.create_named_speaker("Alex")
    memory.update_embedding(alex, _voice(1.0, 0.0, 0.0))
    memory.save()
    db_id = _recording(client, [alex])

    client.post(f"/transcripts/{db_id}/speaker-assignments", json={"segment_starts": [0.0], "speaker_name": "Bob"})

    assert alex in app.dependency_overrides[get_memory_service]().known_speakers


def test_assign_to_a_named_speaker_without_profile_builds_it(client):
    voice = str(uuid_module.uuid4())
    carol = _named("Carol")
    assert carol not in app.dependency_overrides[get_memory_service]().known_speakers
    db_id = _recording(client, [voice])

    r = client.post(f"/transcripts/{db_id}/speaker-assignments", json={"segment_starts": [0.0], "speaker_id": carol})

    assert r.status_code == 200, r.text
    assert carol in app.dependency_overrides[get_memory_service]().known_speakers


def test_assign_unknown_transcript(client):
    r = client.post("/transcripts/999/speaker-assignments", json={"segment_starts": [0.0], "speaker_name": "Dana"})
    assert r.status_code == 404


# ── Undoing an assignment ─────────────────────────────────────────────────────

def test_undo_route_restores_segments_and_a_removed_voice(client):
    memory = app.dependency_overrides[get_memory_service]()
    voice = str(uuid_module.uuid4())
    memory.update_embedding(voice, _voice(1.0, 0.0, 0.0))
    memory.save()
    db_id = _recording(client, [voice, voice])
    created = client.post(f"/transcripts/{db_id}/speaker-assignments", json={
        "segment_starts": [0.0, 1.0], "speaker_name": "Dana",
    }).json()["speaker_id"]
    assert voice not in app.dependency_overrides[get_memory_service]().known_speakers

    r = client.post(f"/transcripts/{db_id}/speaker-assignments/undo", json={
        "segment_starts": [0.0, 1.0], "speaker_id": voice, "created_speaker_id": created,
    })

    assert r.status_code == 204
    assert _speakers_of(client, db_id) == [voice, voice]
    fresh = app.dependency_overrides[get_memory_service]()
    assert voice in fresh.known_speakers
    assert created not in fresh.speaker_ids()


def test_undo_route_skips_a_segment_deleted_after_the_assignment(client):
    voice, alice = str(uuid_module.uuid4()), _named("Alice")
    db_id = _recording(client, [voice, voice])
    client.post(f"/transcripts/{db_id}/speaker-assignments", json={"segment_starts": [0.0, 1.0], "speaker_id": alice})
    client.delete(f"/transcripts/{db_id}/segments/0.0")

    r = client.post(f"/transcripts/{db_id}/speaker-assignments/undo", json={"segment_starts": [0.0, 1.0], "speaker_id": voice})

    assert r.status_code == 204
    assert _speakers_of(client, db_id) == [voice]


def test_undo_route_to_unassigned(client):
    storage = app.dependency_overrides[get_storage_service]()
    voice, alice = str(uuid_module.uuid4()), _named("Alice")
    db_id = _recording(client, [voice])
    storage.unassign_speaker(voice)
    client.post(f"/transcripts/{db_id}/speaker-assignments", json={"segment_starts": [0.0], "speaker_id": alice})

    r = client.post(f"/transcripts/{db_id}/speaker-assignments/undo", json={"segment_starts": [0.0], "speaker_id": "UNASSIGNED"})

    assert r.status_code == 204
    segment = client.get(f"/transcripts/{db_id}").json()["segments"][0]
    assert segment["unassigned"] is True and segment["speaker_resolved"] is None


@pytest.mark.parametrize("body, status", [
    ({"segment_starts": [], "speaker_id": "UNASSIGNED"}, 422),
    ({"segment_starts": [0.0], "speaker_id": "SPEAKER_00"}, 400),
    ({"segment_starts": [0.0], "speaker_id": "UNASSIGNED", "created_speaker_id": "nope"}, 400),
])
def test_undo_route_rejects_a_wrong_request(client, body, status):
    voice = str(uuid_module.uuid4())
    db_id = _recording(client, [voice])
    assert client.post(f"/transcripts/{db_id}/speaker-assignments/undo", json=body).status_code == status
    assert _speakers_of(client, db_id) == [voice]


def test_undo_route_unknown_transcript(client):
    r = client.post("/transcripts/999/speaker-assignments/undo", json={"segment_starts": [0.0], "speaker_id": "UNASSIGNED"})
    assert r.status_code == 404


# ── GET /transcripts/{id}/waveform ────────────────────────────────────────────

def _waveform(client, tid, **params):
    return client.get(f"/transcripts/{tid}/waveform", params=params)


def test_waveform_returns_one_level_per_bar(client, recordings_dir):
    import numpy as np
    from app.services import waveform
    audio = recordings_dir / "sonorus-rec-1.wav"
    audio.write_bytes(b"x")
    db = np.repeat(np.array([-20, -40, -20, -20], dtype=np.float32), waveform.WINDOWS_PER_SECOND)

    with patch_levels(db) as ensure:
        res = _waveform(client, _save(audio), bars=4)

    assert res.status_code == 200
    levels = res.json()["levels"]
    assert len(levels) == 4
    assert levels[0] == 1 and levels[1] < 1
    ensure.assert_called_once()
    assert ensure.call_args.args[0] == str(audio)


def test_waveform_takes_a_stretch_of_the_recording(client, recordings_dir):
    import numpy as np
    from app.services import waveform
    audio = recordings_dir / "sonorus-rec-1.wav"
    audio.write_bytes(b"x")
    db = np.repeat(np.array([-20, -20, -40, -40], dtype=np.float32), waveform.WINDOWS_PER_SECOND)

    with patch_levels(db):
        whole = _waveform(client, _save(audio), bars=2).json()["levels"]
        tail = _waveform(client, _save(audio), bars=2, start=2, end=4).json()["levels"]
        longer = _waveform(client, _save(audio), bars=2, end=8).json()["levels"]

    assert whole[0] == 1 and whole[1] < 1
    assert tail[0] == tail[1] == whole[1]
    assert longer[1] == 0, "past the end of the audio is silence"


def patch_levels(db):
    from unittest.mock import patch
    return patch("app.api.routers.transcripts.ensure_levels", return_value=db)


def test_waveform_unknown_transcript_is_404(client):
    assert _waveform(client, 999, bars=4).status_code == 404


def test_waveform_missing_audio_is_404(client, recordings_dir):
    assert _waveform(client, _save(recordings_dir / "gone.wav"), bars=4).status_code == 404


def test_waveform_empty_path_is_404(client):
    assert _waveform(client, _save(""), bars=4).status_code == 404


@pytest.mark.parametrize("params", [
    {}, {"bars": 0}, {"bars": 2001}, {"bars": 4, "start": -1}, {"bars": 4, "start": 2, "end": 2},
    {"bars": 4, "start": 3, "end": 2},
])
def test_waveform_rejects_bad_parameters(client, recordings_dir, params):
    audio = recordings_dir / "sonorus-rec-1.wav"
    audio.write_bytes(b"x")
    with patch_levels(None) as ensure:
        assert _waveform(client, _save(audio), **params).status_code == 422
    ensure.assert_not_called()


def test_waveform_audio_that_cannot_be_read_is_500(client, recordings_dir):
    from unittest.mock import patch
    from app.services.waveform import WaveformError
    audio = recordings_dir / "sonorus-rec-1.wav"
    audio.write_bytes(b"x")

    with patch("app.api.routers.transcripts.ensure_levels", side_effect=WaveformError("bad")):
        res = _waveform(client, _save(audio), bars=4)

    assert res.status_code == 500
    assert res.json()["detail"] == "Could not read the audio"
