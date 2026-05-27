"""
API tests — REST endpoints for transcripts and speakers.
Transcription WebSocket (/transcribe + /ws) is not tested here
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


# ── Cancel transcription ─────────────────────────────────────────────────────

def test_cancel_transcribe_unknown_job_returns_404(client):
    """DELETE /transcribe/{job_id} returns 404 when the job_id is unknown."""
    r = client.delete("/transcribe/nonexistent-job-id")
    assert r.status_code == 404, (
        f"Expected 404 for unknown job_id, got {r.status_code}: {r.text}"
    )


def test_cancel_transcribe_unknown_job_body(client):
    """DELETE /transcribe/{job_id} 404 body contains cancelled=False."""
    r = client.delete("/transcribe/nonexistent-job-id")
    assert r.status_code == 404
    body = r.json()
    assert body.get("cancelled") is False, (
        f"Expected {{\"cancelled\": false}} for unknown job_id, got {body}"
    )


def test_cancel_transcribe_active_job_returns_200(client):
    """DELETE /transcribe/{job_id} returns 200 and cancelled=True for an active job.

    We inject a cancel event directly into the router's internal dict
    to simulate a running job — avoids launching real ML pipeline.
    """
    import uuid as _uuid
    from app.api.routers import transcription as _tr_router

    job_id = str(_uuid.uuid4())
    import threading
    cancel_event = threading.Event()
    _tr_router._cancel_events[job_id] = cancel_event

    try:
        r = client.delete(f"/transcribe/{job_id}")
        assert r.status_code == 200, (
            f"Expected 200 for active job, got {r.status_code}: {r.text}"
        )
        body = r.json()
        assert body.get("cancelled") is True, (
            f"Expected {{\"cancelled\": true}}, got {body}"
        )
        assert cancel_event.is_set(), (
            "cancel_event must be set after DELETE /transcribe/{job_id}"
        )
    finally:
        _tr_router._cancel_events.pop(job_id, None)


# ── Health ────────────────────────────────────────────────────────────────────

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


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


# ── Segment speaker ───────────────────────────────────────────────────────────

def test_update_segment_speaker(client):
    db_id = _saved_id(client)
    r = client.patch(
        f"/transcripts/{db_id}/segments/0.0/speaker",
        json={"speaker_id": "Carol"},
    )
    assert r.status_code == 204
    segs = client.get(f"/transcripts/{db_id}").json()["segments"]
    assert segs[0]["speaker_resolved"] == "Carol"


def test_update_segment_speaker_not_found(client):
    db_id = _saved_id(client)
    r = client.patch(
        f"/transcripts/{db_id}/segments/99.0/speaker",
        json={"speaker_id": "Carol"},
    )
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


# ── Commit ────────────────────────────────────────────────────────────────────

def test_commit_transcript(client):
    """POST /transcripts/{id}/commit persists the speaker embedding to memory.

    Uses a proper UUID4 speaker_resolved to match production flow — after the
    speaker-UUID refactor, all resolved speaker IDs are UUID4 strings.
    """
    storage = app.dependency_overrides[get_storage_service]()
    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    spk_uuid = str(uuid_module.uuid4())
    t = Transcript(
        audio_path="files/test.wav",
        language="en",
        segments=[
            Segment(0.0, 2.0, "Hello", "SPEAKER_00", speaker_resolved=spk_uuid, embedding=emb),
        ],
    )
    db_id = storage.save(t)
    r = client.post(f"/transcripts/{db_id}/commit")
    assert r.status_code == 204

    memory = app.dependency_overrides[get_memory_service]()
    assert spk_uuid in memory.known_speakers, (
        f"Expected UUID speaker {spk_uuid!r} in memory after commit, "
        f"got keys: {list(memory.known_speakers.keys())}"
    )


def test_commit_transcript_not_found(client):
    r = client.post("/transcripts/999/commit")
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


# ── Bulk reassign ─────────────────────────────────────────────────────────────

def test_reassign_speaker_bulk(client):
    """Bulk reassign using to_speaker_name creates a UUID and updates all matching segments.

    After reassign, segments previously owned by spk_abc must carry the new UUID
    (not the literal name "Alice"). The untouched segment keeps its original speaker.
    """
    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    storage = app.dependency_overrides[get_storage_service]()
    memory = app.dependency_overrides[get_memory_service]()
    # Pre-register "Bob" as a UUID so we can look it up after the reassign
    bob_emb = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    memory.update_embedding("spk_bob", bob_emb)
    memory.save()
    memory.set_name("spk_bob", "Bob")
    memory.save_names_only()

    t = Transcript(
        audio_path="files/test.wav",
        language="en",
        segments=[
            Segment(0.0, 2.0, "Hi",    "SPEAKER_00", speaker_resolved="spk_abc", embedding=emb),
            Segment(2.0, 4.0, "Hello", "SPEAKER_00", speaker_resolved="spk_abc", embedding=emb),
            Segment(4.0, 6.0, "Bye",   "SPEAKER_01", speaker_resolved="spk_bob", embedding=bob_emb),
        ],
    )
    db_id = storage.save(t)
    r = client.post(f"/transcripts/{db_id}/reassign", json={
        "from_speaker_id": "spk_abc",
        "to_speaker_name": "Alice",
    })
    assert r.status_code == 204

    memory2 = app.dependency_overrides[get_memory_service]()
    alice_uuid = memory2.find_by_name("Alice")
    assert alice_uuid is not None, "Alice UUID must be created in memory after reassign"
    assert _is_valid_uuid(alice_uuid), f"Expected a valid UUID, got {alice_uuid!r}"

    segs = client.get(f"/transcripts/{db_id}").json()["segments"]
    assert segs[0]["speaker_resolved"] == alice_uuid
    assert segs[1]["speaker_resolved"] == alice_uuid
    bob_uuid = memory2.find_by_name("Bob")
    assert segs[2]["speaker_resolved"] == bob_uuid


def test_reassign_speaker_not_found(client):
    """POST /reassign on a nonexistent transcript returns 404."""
    r = client.post("/transcripts/999/reassign", json={
        "from_speaker_id": "spk_abc",
        "to_speaker_name": "Alice",
    })
    assert r.status_code == 404


def test_two_sequential_reassigns_leave_no_ghost_speaker(client):
    """Two sequential reassigns must leave exactly two UUID speakers in memory.

    The original spk_aaa and spk_bbb must be removed; only the two newly
    created UUID speakers (one for Alice, one for Bob) should remain.
    Both resulting keys must start with spk_ and be resolvable by name.
    """
    emb_a = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_b = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    storage = app.dependency_overrides[get_storage_service]()
    t = Transcript(
        audio_path="files/test.wav",
        language="en",
        segments=[
            Segment(0.0, 2.0, "Hi",  "SPEAKER_00", speaker_resolved="spk_aaa", embedding=emb_a),
            Segment(2.0, 4.0, "Bye", "SPEAKER_01", speaker_resolved="spk_bbb", embedding=emb_b),
        ],
    )
    db_id = storage.save(t)

    client.post(f"/transcripts/{db_id}/reassign", json={
        "from_speaker_id": "spk_aaa",
        "to_speaker_name": "Alice",
    })
    client.post(f"/transcripts/{db_id}/reassign", json={
        "from_speaker_id": "spk_bbb",
        "to_speaker_name": "Bob",
    })

    memory = app.dependency_overrides[get_memory_service]()
    keys = list(memory.known_speakers.keys())
    assert len(keys) == 2, f"Expected exactly 2 speakers in memory, got {keys!r}"
    for k in keys:
        assert _is_valid_uuid(k), f"Expected a valid UUID key, got {k!r}"
    assert memory.find_by_name("Alice") is not None, "Alice must be resolvable by name"
    assert memory.find_by_name("Bob") is not None, "Bob must be resolvable by name"


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


def test_sequential_reassigns_do_not_inflate_speaker_counts(client):
    """Each named speaker should be committed exactly once even when multiple
    reassigns are performed on the same transcript.

    After two sequential reassigns the first speaker (Alice) must have count == 1,
    not 2. Speaker IDs in memory must be UUIDs (spk_*), not display names.
    """
    emb_a = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_b = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    storage = app.dependency_overrides[get_storage_service]()
    t = Transcript(
        audio_path="files/test.wav",
        language="en",
        segments=[
            Segment(0.0, 2.0, "Hi",  "SPEAKER_00", speaker_resolved="spk_aaa", embedding=emb_a),
            Segment(2.0, 4.0, "Bye", "SPEAKER_01", speaker_resolved="spk_bbb", embedding=emb_b),
        ],
    )
    db_id = storage.save(t)

    # First reassign: spk_aaa → Alice
    r1 = client.post(f"/transcripts/{db_id}/reassign", json={
        "from_speaker_id": "spk_aaa",
        "to_speaker_name": "Alice",
    })
    assert r1.status_code == 204

    # Second reassign: spk_bbb → Bob  (must NOT re-commit Alice)
    r2 = client.post(f"/transcripts/{db_id}/reassign", json={
        "from_speaker_id": "spk_bbb",
        "to_speaker_name": "Bob",
    })
    assert r2.status_code == 204

    memory = app.dependency_overrides[get_memory_service]()
    alice_uuid = memory.find_by_name("Alice")
    bob_uuid = memory.find_by_name("Bob")
    assert alice_uuid is not None, "Alice must be resolvable by name"
    assert bob_uuid is not None, "Bob must be resolvable by name"
    # Each named speaker must appear exactly once in memory — count == 1
    assert memory.known_counts.get(alice_uuid) == 1, (
        f"Alice.count should be 1 but got {memory.known_counts.get(alice_uuid)}"
    )
    assert memory.known_counts.get(bob_uuid) == 1, (
        f"Bob.count should be 1 but got {memory.known_counts.get(bob_uuid)}"
    )


# ── New reassign contract tests ───────────────────────────────────────────────

def test_reassign_to_new_speaker_by_name_creates_uuid(client):
    """POST /reassign with to_speaker_name creates a new UUID4 in memory.

    The segment's speaker_resolved must be updated to the new UUID,
    not to the literal name string. The UUID must be findable via find_by_name().
    """
    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    storage = app.dependency_overrides[get_storage_service]()
    t = Transcript(
        audio_path="files/test.wav",
        language="en",
        segments=[
            Segment(0.0, 2.0, "Hello", "SPEAKER_00", speaker_resolved="spk_aaa", embedding=emb),
        ],
    )
    db_id = storage.save(t)

    r = client.post(f"/transcripts/{db_id}/reassign", json={
        "from_speaker_id": "spk_aaa",
        "to_speaker_name": "Carlos",
    })
    assert r.status_code == 204

    memory = app.dependency_overrides[get_memory_service]()
    found_uuid = memory.find_by_name("Carlos")
    assert found_uuid is not None, "find_by_name('Carlos') must return a UUID after reassign"
    assert _is_valid_uuid(found_uuid), f"UUID must be a valid UUID, got {found_uuid!r}"
    assert found_uuid in memory.known_speakers, "UUID must be present in known_speakers"

    segs = client.get(f"/transcripts/{db_id}").json()["segments"]
    assert segs[0]["speaker_resolved"] == found_uuid, (
        f"Segment speaker_resolved must be UUID {found_uuid!r}, "
        f"not literal name. Got {segs[0]['speaker_resolved']!r}"
    )


def test_reassign_to_existing_speaker_by_id(client):
    """POST /reassign with to_speaker_id merges onto an existing UUID from memory.

    The source UUID (spk_source) is an unrecognized temp speaker and must be
    removed from memory after reassign. The target UUID (spk_existing) must
    remain, the segment must carry it, and its embedding count must reflect
    the number of DB segments now assigned to spk_existing.
    """
    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_source = np.array([0.9, 0.1, 0.0], dtype=np.float32)
    memory = app.dependency_overrides[get_memory_service]()
    memory.update_embedding("spk_existing", emb)
    memory.save()

    storage = app.dependency_overrides[get_storage_service]()
    t = Transcript(
        audio_path="files/test.wav",
        language="en",
        segments=[
            Segment(0.0, 2.0, "Hello", "SPEAKER_00", speaker_resolved="spk_source", embedding=emb_source),
        ],
    )
    db_id = storage.save(t)

    r = client.post(f"/transcripts/{db_id}/reassign", json={
        "from_speaker_id": "spk_source",
        "to_speaker_id": "spk_existing",
    })
    assert r.status_code == 204

    memory2 = app.dependency_overrides[get_memory_service]()
    segs = client.get(f"/transcripts/{db_id}").json()["segments"]
    assert segs[0]["speaker_resolved"] == "spk_existing", (
        f"Segment must carry to_speaker_id UUID, got {segs[0]['speaker_resolved']!r}"
    )
    assert "spk_source" not in memory2.known_speakers, (
        "spk_source must be removed from memory after reassign"
    )
    assert "spk_existing" in memory2.known_speakers, (
        "spk_existing must remain in memory after reassign"
    )
    count_after = memory2.known_counts.get("spk_existing", 0)
    assert count_after == 1, (
        f"spk_existing count must equal the number of DB segments (1) after absorbing spk_source's segment; "
        f"got {count_after}"
    )


def test_reassign_two_speakers_same_name_creates_distinct_uuids(client):
    """Two different speakers reassigned to the same display name get distinct UUIDs.

    After two separate reassigns with to_speaker_name="Maria", memory must contain
    exactly 2 entries, both starting with spk_, and both findable by name "Maria".
    """
    emb_a = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_b = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    storage = app.dependency_overrides[get_storage_service]()
    t = Transcript(
        audio_path="files/test.wav",
        language="en",
        segments=[
            Segment(0.0, 2.0, "One", "SPEAKER_00", speaker_resolved="spk_aaa", embedding=emb_a),
            Segment(2.0, 4.0, "Two", "SPEAKER_01", speaker_resolved="spk_bbb", embedding=emb_b),
        ],
    )
    db_id = storage.save(t)

    r1 = client.post(f"/transcripts/{db_id}/reassign", json={
        "from_speaker_id": "spk_aaa",
        "to_speaker_name": "Maria",
    })
    assert r1.status_code == 204

    r2 = client.post(f"/transcripts/{db_id}/reassign", json={
        "from_speaker_id": "spk_bbb",
        "to_speaker_name": "Maria",
    })
    assert r2.status_code == 204

    memory = app.dependency_overrides[get_memory_service]()
    keys = list(memory.known_speakers.keys())
    assert len(keys) == 2, f"Expected exactly 2 speakers in memory, got {keys!r}"
    assert keys[0] != keys[1], "Two reassigns to same name must create distinct UUIDs"
    for k in keys:
        assert _is_valid_uuid(k), f"Expected a valid UUID, got {k!r}"
    maria_uuid = memory.find_by_name("Maria")
    assert maria_uuid is not None, "At least one speaker named Maria must be findable"


def test_reassign_from_recognized_speaker_keeps_it_in_memory(client):
    """Reassigning FROM a recognized (named) speaker must not delete it from memory.

    If spk_named is a recognized speaker with a display name, and we reassign
    segments FROM it to a new name, spk_named itself must remain in known_speakers
    because it is a recognized identity (not a temporary UNRECOGNIZED UUID).
    """
    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_b = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    memory = app.dependency_overrides[get_memory_service]()
    memory.update_embedding("spk_named", emb)
    memory.save()
    memory.set_name("spk_named", "Alex")
    memory.save_names_only()

    storage = app.dependency_overrides[get_storage_service]()
    t = Transcript(
        audio_path="files/test.wav",
        language="en",
        segments=[
            Segment(0.0, 2.0, "Named",   "SPEAKER_00", speaker_resolved="spk_named",   embedding=emb),
            Segment(2.0, 4.0, "Unknown", "SPEAKER_01", speaker_resolved="spk_unknown", embedding=emb_b),
        ],
    )
    db_id = storage.save(t)

    r = client.post(f"/transcripts/{db_id}/reassign", json={
        "from_speaker_id": "spk_named",
        "to_speaker_name": "Bob",
    })
    assert r.status_code == 204

    memory2 = app.dependency_overrides[get_memory_service]()
    assert "spk_named" in memory2.known_speakers, (
        "spk_named is a recognized speaker and must NOT be removed from memory "
        "when it is the source of a reassign"
    )


def test_reassign_missing_to_field_returns_400(client):
    """POST /reassign with neither to_speaker_id nor to_speaker_name returns 400."""
    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    storage = app.dependency_overrides[get_storage_service]()
    t = Transcript(
        audio_path="files/test.wav",
        language="en",
        segments=[
            Segment(0.0, 2.0, "Hello", "SPEAKER_00", speaker_resolved="spk_aaa", embedding=emb),
        ],
    )
    db_id = storage.save(t)

    r = client.post(f"/transcripts/{db_id}/reassign", json={
        "from_speaker_id": "spk_aaa",
    })
    assert r.status_code == 400, (
        f"Expected 400 when neither to_speaker_id nor to_speaker_name is provided, "
        f"got {r.status_code}"
    )


def test_reassign_both_to_fields_returns_400(client):
    """POST /reassign with both to_speaker_id and to_speaker_name returns 400."""
    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    storage = app.dependency_overrides[get_storage_service]()
    t = Transcript(
        audio_path="files/test.wav",
        language="en",
        segments=[
            Segment(0.0, 2.0, "Hello", "SPEAKER_00", speaker_resolved="spk_aaa", embedding=emb),
        ],
    )
    db_id = storage.save(t)

    r = client.post(f"/transcripts/{db_id}/reassign", json={
        "from_speaker_id": "spk_aaa",
        "to_speaker_id": "spk_bbb",
        "to_speaker_name": "Alice",
    })
    assert r.status_code == 400, (
        f"Expected 400 when both to_speaker_id and to_speaker_name are provided, "
        f"got {r.status_code}"
    )


def test_reassign_one_speaker_also_commits_the_other(client):
    """Reassigning only one speaker should still persist the other speaker's
    embedding in memory so they can be recognised in the next session.

    Bug: reassign_speaker calls commit_speaker(t, to_speaker_id) which only
    commits the newly assigned speaker.  The other speaker's embedding is never
    written to memory.known_speakers, so they will be unrecognised next time.
    """
    emb_a = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_b = np.array([0.0, 1.0, 0.0], dtype=np.float32)  # orthogonal to emb_a
    storage = app.dependency_overrides[get_storage_service]()
    t = Transcript(
        audio_path="files/test.wav",
        language="en",
        segments=[
            Segment(0.0, 2.0, "Hi",  "SPEAKER_00", speaker_resolved="spk_aaa", embedding=emb_a),
            Segment(2.0, 4.0, "Bye", "SPEAKER_01", speaker_resolved="spk_bbb", embedding=emb_b),
        ],
    )
    db_id = storage.save(t)

    # Only reassign one of the two speakers
    r = client.post(f"/transcripts/{db_id}/reassign", json={
        "from_speaker_id": "spk_aaa",
        "to_speaker_name": "Alice",
    })
    assert r.status_code == 204

    memory = app.dependency_overrides[get_memory_service]()
    # The assigned speaker must be in memory (stored under a UUID)
    alice_uuid = memory.find_by_name("Alice")
    assert alice_uuid is not None, "Alice should be committed to memory after reassign"
    assert alice_uuid in memory.known_speakers
    # The unassigned speaker's embedding must also be in memory so they can be
    # recognised in the next session — this is the bug being tested
    assert "spk_bbb" in memory.known_speakers, (
        "spk_bbb embedding should be committed to memory even though it was not reassigned"
    )
