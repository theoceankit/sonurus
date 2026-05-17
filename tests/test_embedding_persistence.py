"""
Tests for issues #6 and #7:
  #6 — seg.embedding is never persisted to DB; load() returns None for all
       embeddings, so CommitService silently skips updating speaker memory.
  #7 — segments.speaker_id FK references speaker_embeddings(id) but the
       speaker doesn't exist there at save time; fixed by committing before
       saving.

All tests in this file are expected to FAIL before the fix is implemented.
"""

import sqlite3

import numpy as np
import pytest

from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.commit_service import CommitService
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_storage(tmp_path):
    return TranscriptStorageService(db_path=str(tmp_path / "transcripts.db"))


def make_memory(tmp_path):
    return SpeakerMemoryService(db_path=str(tmp_path / "memory.db"))


def make_transcript(segments=None, audio_path="files/test.wav", language="en"):
    if segments is None:
        segments = [
            Segment(0.0, 2.0, "Hello", "SPEAKER_00", speaker_resolved="Alice"),
        ]
    return Transcript(audio_path=audio_path, language=language, segments=segments)


EMB_4D = np.array([0.1, 0.2, 0.3, 0.4], dtype=np.float32)
EMB_4D_B = np.array([0.9, 0.8, 0.7, 0.6], dtype=np.float32)
EMB_4D_C = np.array([0.5, 0.5, 0.5, 0.5], dtype=np.float32)


# ---------------------------------------------------------------------------
# Round-trip: basic persistence
# ---------------------------------------------------------------------------

def test_save_persists_embedding_blob(tmp_path):
    """save() stores a non-null BLOB in the segments.embedding column."""
    svc = make_storage(tmp_path)
    seg = Segment(0.0, 2.0, "Hi", "SPEAKER_00", speaker_resolved="Alice",
                  embedding=EMB_4D)
    db_id = svc.save(make_transcript(segments=[seg]))

    with sqlite3.connect(str(tmp_path / "transcripts.db")) as conn:
        row = conn.execute(
            "SELECT embedding FROM segments WHERE transcription_id = ?",
            (db_id,),
        ).fetchone()

    assert row is not None
    assert row[0] is not None, "embedding BLOB must be non-null after save()"


def test_load_restores_embedding(tmp_path):
    """load() returns a segment whose .embedding matches the saved array."""
    svc = make_storage(tmp_path)
    seg = Segment(0.0, 2.0, "Hi", "SPEAKER_00", speaker_resolved="Alice",
                  embedding=EMB_4D)
    db_id = svc.save(make_transcript(segments=[seg]))

    loaded = svc.load(db_id)

    assert loaded.segments[0].embedding is not None, "embedding must be restored by load()"
    assert np.allclose(loaded.segments[0].embedding, EMB_4D), (
        f"Expected {EMB_4D}, got {loaded.segments[0].embedding}"
    )


def test_load_embedding_dtype_is_float32(tmp_path):
    """Loaded embedding array has dtype float32."""
    svc = make_storage(tmp_path)
    seg = Segment(0.0, 2.0, "Hi", "SPEAKER_00", speaker_resolved="Alice",
                  embedding=EMB_4D)
    db_id = svc.save(make_transcript(segments=[seg]))

    loaded = svc.load(db_id)

    assert loaded.segments[0].embedding.dtype == np.float32, (
        f"Expected float32, got {loaded.segments[0].embedding.dtype}"
    )


def test_load_embedding_is_writable(tmp_path):
    """Loaded embedding is a writable array (not a read-only frombuffer view)."""
    svc = make_storage(tmp_path)
    seg = Segment(0.0, 2.0, "Hi", "SPEAKER_00", speaker_resolved="Alice",
                  embedding=EMB_4D)
    db_id = svc.save(make_transcript(segments=[seg]))

    loaded = svc.load(db_id)
    emb = loaded.segments[0].embedding

    # This must NOT raise ValueError: assignment destination is read-only
    emb[0] = 0.0


# ---------------------------------------------------------------------------
# None / mixed cases
# ---------------------------------------------------------------------------

def test_save_segment_without_embedding_writes_null(tmp_path):
    """A segment with embedding=None saves as NULL and loads back as None."""
    svc = make_storage(tmp_path)
    seg = Segment(0.0, 2.0, "Hi", "SPEAKER_00", speaker_resolved="Alice",
                  embedding=None)
    db_id = svc.save(make_transcript(segments=[seg]))

    # Verify NULL in DB
    with sqlite3.connect(str(tmp_path / "transcripts.db")) as conn:
        row = conn.execute(
            "SELECT embedding FROM segments WHERE transcription_id = ?",
            (db_id,),
        ).fetchone()
    assert row[0] is None, "NULL embedding must be stored as NULL BLOB"

    # Verify loaded as None
    loaded = svc.load(db_id)
    assert loaded.segments[0].embedding is None, "NULL BLOB must deserialise to None"


def test_load_handles_mixed_embeddings(tmp_path):
    """3 segments: 2 with embeddings, 1 with None; all round-trip correctly."""
    svc = make_storage(tmp_path)
    segments = [
        Segment(0.0, 2.0, "First",  "SPEAKER_00", speaker_resolved="Alice",
                embedding=EMB_4D),
        Segment(2.0, 4.0, "Second", "SPEAKER_00", speaker_resolved="Alice",
                embedding=None),
        Segment(4.0, 6.0, "Third",  "SPEAKER_01", speaker_resolved="Bob",
                embedding=EMB_4D_B),
    ]
    db_id = svc.save(make_transcript(segments=segments))
    loaded = svc.load(db_id)

    # Sorted by start
    assert np.allclose(loaded.segments[0].embedding, EMB_4D), "First embedding mismatch"
    assert loaded.segments[1].embedding is None, "Middle None embedding must stay None"
    assert np.allclose(loaded.segments[2].embedding, EMB_4D_B), "Third embedding mismatch"


def test_save_accepts_non_float32_array(tmp_path):
    """A float64 embedding is serialised and loaded back as float32 with equal values."""
    svc = make_storage(tmp_path)
    emb_f64 = np.array([0.1, 0.2, 0.3, 0.4], dtype=np.float64)
    seg = Segment(0.0, 2.0, "Hi", "SPEAKER_00", speaker_resolved="Alice",
                  embedding=emb_f64)
    db_id = svc.save(make_transcript(segments=[seg]))

    loaded = svc.load(db_id)

    assert loaded.segments[0].embedding.dtype == np.float32, (
        "Embedding must be stored/loaded as float32 regardless of input dtype"
    )
    assert np.allclose(loaded.segments[0].embedding, emb_f64), (
        "Values must be preserved after float64 → float32 conversion"
    )


# ---------------------------------------------------------------------------
# Migration / back-compat
# ---------------------------------------------------------------------------

def test_migration_adds_embedding_column_to_legacy_db(tmp_path):
    """
    A legacy segments table without an embedding column is upgraded
    transparently on TranscriptStorageService construction. No exception is
    raised, the column is present afterwards, and load() returns embedding=None
    for the pre-existing row.
    """
    db_path = str(tmp_path / "legacy.db")

    # Create old-style schema (no embedding column) and insert one row manually
    with sqlite3.connect(db_path) as conn:
        conn.execute("""
            CREATE TABLE transcriptions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                audio_file TEXT NOT NULL,
                language   TEXT,
                status     TEXT DEFAULT 'draft',
                created_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE segments (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                transcription_id INTEGER NOT NULL,
                speaker_id       TEXT,
                start            REAL NOT NULL,
                end              REAL NOT NULL,
                text             TEXT NOT NULL,
                speaker_raw      TEXT
            )
        """)
        conn.execute(
            "INSERT INTO transcriptions (audio_file, language, created_at) VALUES (?, ?, ?)",
            ("files/old.wav", "en", "2024-01-01T00:00:00"),
        )
        conn.execute(
            "INSERT INTO segments (transcription_id, speaker_id, start, end, text, speaker_raw)"
            " VALUES (1, 'Alice', 0.0, 2.0, 'Legacy text', 'SPEAKER_00')",
        )

    # Constructing the service must not raise even with an old schema
    svc = TranscriptStorageService(db_path=db_path)

    # The embedding column must now exist
    with sqlite3.connect(db_path) as conn:
        cols = {row[1] for row in conn.execute("PRAGMA table_info(segments)").fetchall()}
    assert "embedding" in cols, "Migration must add the embedding column"

    # Loading the legacy row must not fail; embedding should be None
    loaded = svc.load(1)
    assert loaded.segments[0].embedding is None, (
        "Legacy rows without embedding must load as None"
    )


# ---------------------------------------------------------------------------
# Update methods must preserve embeddings
# ---------------------------------------------------------------------------

def test_update_segments_speaker_preserves_embeddings(tmp_path):
    """
    update_segments_speaker() changes speaker_id but must not clear the
    embedding column for affected rows.
    """
    svc = make_storage(tmp_path)
    segments = [
        Segment(0.0, 2.0, "Hi",    "SPEAKER_00", speaker_resolved="Alice",
                embedding=EMB_4D),
        Segment(2.0, 4.0, "Hello", "SPEAKER_00", speaker_resolved="Alice",
                embedding=EMB_4D_B),
    ]
    db_id = svc.save(make_transcript(segments=segments))

    svc.update_segments_speaker(db_id, "Alice", "Carol")

    loaded = svc.load(db_id)
    assert np.allclose(loaded.segments[0].embedding, EMB_4D), (
        "Embedding for first segment must survive update_segments_speaker()"
    )
    assert np.allclose(loaded.segments[1].embedding, EMB_4D_B), (
        "Embedding for second segment must survive update_segments_speaker()"
    )


def test_update_segment_speaker_preserves_embedding(tmp_path):
    """
    update_segment_speaker() changes one segment's speaker_id but must not
    clear that segment's embedding.
    """
    svc = make_storage(tmp_path)
    seg = Segment(0.0, 2.0, "Hi", "SPEAKER_00", speaker_resolved="Alice",
                  embedding=EMB_4D)
    db_id = svc.save(make_transcript(segments=[seg]))

    svc.update_segment_speaker(db_id, start=0.0, end=2.0, new_speaker="Carol")

    loaded = svc.load(db_id)
    assert np.allclose(loaded.segments[0].embedding, EMB_4D), (
        "Embedding must survive update_segment_speaker()"
    )


# ---------------------------------------------------------------------------
# End-to-end: stale transcript reassignment (#6 user-visible bug)
# ---------------------------------------------------------------------------

def test_reassignment_on_loaded_transcript_updates_speaker_memory(tmp_path):
    """
    End-to-end test for the user-visible bug in #6:

    1. A transcript is produced with a known per-segment embedding.
    2. It is saved to DB (simulating pipeline completion).
    3. It is loaded back from DB (simulating the user opening it from the
       sidebar — this is the broken path: previously embeddings came back None).
    4. The user reassigns the segment to a named speaker via speaker_final.
    5. CommitService.commit() is called on the loaded transcript.
    6. The speaker memory must contain the named speaker with the original
       embedding.

    This test MUST FAIL before issue #6 is fixed because load() currently
    returns embedding=None, so commit() silently skips every segment and
    the memory is never updated.
    """
    storage = make_storage(tmp_path)
    memory = make_memory(tmp_path)

    original_embedding = np.array([0.1, 0.2, 0.3, 0.4], dtype=np.float32)

    seg = Segment(
        0.0, 2.0, "It is me", "SPEAKER_00",
        speaker_resolved="spk_unknown",
        embedding=original_embedding,
    )
    transcript = make_transcript(segments=[seg])

    # Step 1+2: save (as pipeline would)
    db_id = storage.save(transcript)

    # Step 3: load (as sidebar open would)
    loaded = storage.load(db_id)

    # Step 4: user assigns the speaker
    loaded.segments[0].speaker_final = "carol"
    storage.update_segment_speaker(db_id, 0.0, 2.0, "carol")

    # Step 5: commit
    CommitService(memory, storage).commit(loaded)

    # Step 6: assert memory was updated with the correct embedding
    assert "carol" in memory.known_speakers, (
        "carol must be in speaker memory after commit on loaded transcript; "
        "this fails when load() returns embedding=None (issue #6)"
    )
    expected = original_embedding / np.linalg.norm(original_embedding)
    assert np.allclose(memory.known_speakers["carol"], expected), (
        f"Expected {expected}, got {memory.known_speakers.get('carol')}"
    )
