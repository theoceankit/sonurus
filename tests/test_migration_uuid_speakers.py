"""
Tests for DB migration m001_uuid_speakers.

The migration runs inside SpeakerMemoryService._init_db() on startup.
It converts any speaker_embeddings.id that is not a UUID into a proper
UUID4 (standard xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx format), stores the
original name in speaker_names (label='display'), and updates all
segments.speaker_id references accordingly.

All tests create the SQLite schema directly via sqlite3 (without
SpeakerMemoryService), then instantiate SpeakerMemoryService to trigger
_init_db(), and assert on the resulting DB state.
"""

import sqlite3
import struct
import uuid as uuid_module

import numpy as np
import pytest

from app.services.speaker_memory_service import SpeakerMemoryService


def _is_valid_uuid(value: str) -> bool:
    """Return True if value is a valid UUID (any version)."""
    try:
        uuid_module.UUID(value)
        return True
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_db(db_path: str) -> None:
    """Create the pre-migration legacy schema."""
    with sqlite3.connect(db_path) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS speaker_embeddings (
                id      TEXT PRIMARY KEY,
                embedding BLOB,
                count   INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS speaker_names (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                speaker_id TEXT NOT NULL REFERENCES speaker_embeddings(id),
                label      TEXT NOT NULL,
                name       TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS transcriptions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                audio_file TEXT,
                language   TEXT,
                status     TEXT DEFAULT 'draft',
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS segments (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                transcription_id INTEGER REFERENCES transcriptions(id),
                speaker_id       TEXT,
                start            REAL,
                end              REAL,
                text             TEXT,
                speaker_raw      TEXT,
                embedding        BLOB
            );
        """)


def _make_embedding(seed: int = 0) -> bytes:
    """Return a tiny serialised float32 embedding."""
    arr = np.array([1.0, float(seed), 0.0], dtype=np.float32)
    return arr.tobytes()


def _insert_speaker(db_path: str, speaker_id: str, seed: int = 0) -> None:
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO speaker_embeddings (id, embedding, count) VALUES (?, ?, 1)",
            (speaker_id, _make_embedding(seed)),
        )


def _insert_transcription(db_path: str) -> int:
    with sqlite3.connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO transcriptions (audio_file, language, status) VALUES (?, ?, ?)",
            ("audio.wav", "en", "draft"),
        )
        return cur.lastrowid


def _insert_segment(db_path: str, transcription_id: int, speaker_id: str) -> int:
    with sqlite3.connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO segments (transcription_id, speaker_id, start, end, text, speaker_raw) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (transcription_id, speaker_id, 0.0, 2.0, "Hello", "SPEAKER_00"),
        )
        return cur.lastrowid


def _all_speaker_ids(db_path: str) -> list[str]:
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute("SELECT id FROM speaker_embeddings").fetchall()
    return [r[0] for r in rows]


def _speaker_names_rows(db_path: str) -> list[tuple]:
    """Return all (speaker_id, label, name) rows from speaker_names."""
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT speaker_id, label, name FROM speaker_names"
        ).fetchall()
    return rows


def _segment_speaker_id(db_path: str, segment_id: int) -> str | None:
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT speaker_id FROM segments WHERE id = ?", (segment_id,)
        ).fetchone()
    return row[0] if row else None


# ---------------------------------------------------------------------------
# Test 1 — legacy named speaker is migrated to a UUID
# ---------------------------------------------------------------------------

def test_legacy_named_speaker_migrated_to_uuid(tmp_path):
    """
    A speaker_embeddings row whose id is a human name (not a UUID) must be
    renamed to a standard UUID4 after _init_db() runs.

    Assertions:
    - No row with id='Smith' remains in speaker_embeddings.
    - Exactly one row exists, its id is a valid UUID4.
    - speaker_names contains (new_uuid, 'display', 'Smith').
    - The segment's speaker_id is updated to the new UUID.
    """
    db_path = str(tmp_path / "memory.db")
    _make_db(db_path)
    _insert_speaker(db_path, "Smith")
    txn_id = _insert_transcription(db_path)
    seg_id = _insert_segment(db_path, txn_id, "Smith")

    # Trigger migration.
    SpeakerMemoryService(db_path=db_path)

    ids = _all_speaker_ids(db_path)
    assert "Smith" not in ids, "Legacy ID must be replaced"
    assert len(ids) == 1, "Exactly one speaker row must exist after migration"
    new_id = ids[0]
    assert _is_valid_uuid(new_id), f"New ID must be a valid UUID, got: {new_id!r}"

    names = _speaker_names_rows(db_path)
    assert len(names) == 1
    assert names[0][0] == new_id
    assert names[0][1] == "display"
    assert names[0][2] == "Smith"

    updated_speaker_id = _segment_speaker_id(db_path, seg_id)
    assert updated_speaker_id == new_id, (
        f"Segment speaker_id must be updated to {new_id!r}, got {updated_speaker_id!r}"
    )


# ---------------------------------------------------------------------------
# Test 2 — UUID speakers (spk_*) are left untouched
# ---------------------------------------------------------------------------

def test_uuid_speaker_not_modified(tmp_path):
    """
    A speaker_embeddings row whose id already starts with 'spk_' must not be
    renamed or otherwise altered by the migration.
    """
    db_path = str(tmp_path / "memory.db")
    _make_db(db_path)
    _insert_speaker(db_path, "spk_abc12345")

    SpeakerMemoryService(db_path=db_path)

    ids = _all_speaker_ids(db_path)
    assert ids == ["spk_abc12345"], (
        f"UUID speaker must be preserved unchanged, got: {ids}"
    )


# ---------------------------------------------------------------------------
# Test 3 — migration is idempotent
# ---------------------------------------------------------------------------

def test_migration_is_idempotent(tmp_path):
    """
    Running _init_db() twice (by creating two SpeakerMemoryService instances
    against the same DB) must produce exactly one speaker_embeddings row and
    exactly one speaker_names row — no duplication.
    """
    db_path = str(tmp_path / "memory.db")
    _make_db(db_path)
    _insert_speaker(db_path, "Smith")

    # First instantiation — triggers migration.
    SpeakerMemoryService(db_path=db_path)
    # Second instantiation — must be a no-op.
    SpeakerMemoryService(db_path=db_path)

    ids = _all_speaker_ids(db_path)
    assert len(ids) == 1, f"Expected 1 speaker row, got {len(ids)}: {ids}"

    names = _speaker_names_rows(db_path)
    assert len(names) == 1, f"Expected 1 speaker_names row, got {len(names)}: {names}"


# ---------------------------------------------------------------------------
# Test 4 — multiple legacy speakers are migrated independently
# ---------------------------------------------------------------------------

def test_multiple_legacy_speakers_migrated_independently(tmp_path):
    """
    When two named speakers exist they must each receive a distinct UUID4,
    and both display names must appear in speaker_names.
    """
    db_path = str(tmp_path / "memory.db")
    _make_db(db_path)
    _insert_speaker(db_path, "Alice", seed=1)
    _insert_speaker(db_path, "Bob", seed=2)

    SpeakerMemoryService(db_path=db_path)

    ids = _all_speaker_ids(db_path)
    assert len(ids) == 2, f"Expected 2 speaker rows, got {len(ids)}: {ids}"
    for spk_id in ids:
        assert _is_valid_uuid(spk_id), f"ID must be a valid UUID, got: {spk_id!r}"
    assert ids[0] != ids[1], "Each speaker must receive a distinct UUID"

    names = _speaker_names_rows(db_path)
    assert len(names) == 2, f"Expected 2 speaker_names rows, got {len(names)}: {names}"
    migrated_names = {row[2] for row in names}
    assert migrated_names == {"Alice", "Bob"}
    for row in names:
        assert row[1] == "display"
        assert _is_valid_uuid(row[0]), f"speaker_names.speaker_id must be a valid UUID, got: {row[0]!r}"


# ---------------------------------------------------------------------------
# Test 5 — known_speakers contains UUID keys after migration
# ---------------------------------------------------------------------------

def test_known_speakers_has_uuid_keys_after_migration(tmp_path):
    """
    After SpeakerMemoryService is initialised against a DB that contained a
    human-name speaker, known_speakers must use the new UUID4 as key —
    not the original name.
    """
    db_path = str(tmp_path / "memory.db")
    _make_db(db_path)
    _insert_speaker(db_path, "Smith")

    memory = SpeakerMemoryService(db_path=db_path)

    assert "Smith" not in memory.known_speakers, (
        "Legacy name must not appear as a key in known_speakers"
    )
    uuid_keys = [k for k in memory.known_speakers if _is_valid_uuid(k)]
    assert len(uuid_keys) == 1, (
        f"Expected exactly one UUID4 key in known_speakers, got: {list(memory.known_speakers.keys())}"
    )
