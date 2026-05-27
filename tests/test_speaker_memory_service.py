"""
Tests for SpeakerMemoryService — resolve() purity, speaker matching, set_name(),
get_name(), save_names_only(), find_by_name(), save/reload persistence, and
DB migration m001_uuid_speakers.

Sections:
  - resolve(): purity invariant + matching correctness
  - set_name() / get_name(): display-name management
  - save() / reload(): embedding and name persistence
  - save_names_only(): writes speaker_names without touching speaker_embeddings
  - find_by_name(): reverse lookup
  - Migration m001_uuid_speakers: converts legacy human-name IDs to UUID4
"""

import sqlite3
import uuid as uuid_module

import numpy as np
import pytest
from app.services.speaker_memory_service import SpeakerMemoryService


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _is_valid_uuid(value: str) -> bool:
    """Return True if value is a valid UUID (any version)."""
    try:
        uuid_module.UUID(value)
        return True
    except ValueError:
        return False


def make_memory(tmp_path, known=None):
    svc = SpeakerMemoryService(db_path=str(tmp_path / "memory.db"))
    if known:
        svc.known_speakers = {k: np.array(v) for k, v in known.items()}
    return svc


def make_memory_with_speaker(tmp_path, spk_id="Alice"):
    """Memory with one speaker embedding (dirty, ready for save())."""
    svc = make_memory(tmp_path)
    svc.update_embedding(spk_id, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    return svc


# ---------------------------------------------------------------------------
# resolve() — purity and matching correctness
# ---------------------------------------------------------------------------

def test_resolve_does_not_mutate_known_speakers(tmp_path):
    """resolve() must not add or modify any entry in known_speakers."""
    emb_known = np.array([1.0, 0.0, 0.0])
    memory = make_memory(tmp_path, known={"person_1": emb_known.tolist()})

    snapshot_before = {k: v.copy() for k, v in memory.known_speakers.items()}

    memory.resolve({"SPEAKER_00": np.array([0.99, 0.01, 0.0])})

    assert set(memory.known_speakers.keys()) == set(snapshot_before.keys()), \
        "resolve() must not add new entries to known_speakers"

    for name, emb in snapshot_before.items():
        assert np.allclose(memory.known_speakers[name], emb), \
            f"resolve() must not modify the embedding for {name}"


def test_resolve_does_not_add_unknown_speaker_to_memory(tmp_path):
    """An unrecognized speaker gets a temporary ID from resolve() but is NOT added to known_speakers."""
    memory = make_memory(tmp_path, known={"person_1": [1.0, 0.0, 0.0]})

    result = memory.resolve({"SPEAKER_00": np.array([0.0, 0.0, 1.0])})

    assert "SPEAKER_00" in result
    new_id = result["SPEAKER_00"]

    assert new_id not in memory.known_speakers, \
        "Temporary ID from resolve() must not be added to known_speakers"


def test_resolve_returns_correct_mapping(tmp_path):
    """resolve() correctly matches new speakers against known ones."""
    memory = make_memory(tmp_path, known={
        "person_1": [1.0, 0.0, 0.0],
        "person_2": [0.0, 0.0, 1.0],
    })

    result = memory.resolve({
        "SPEAKER_00": np.array([0.98, 0.02, 0.0]),
        "SPEAKER_01": np.array([0.01, 0.0, 0.99]),
    })

    assert result["SPEAKER_00"] == "person_1"
    assert result["SPEAKER_01"] == "person_2"


def test_resolve_unknown_speaker_gets_uuid(tmp_path):
    """An unrecognized speaker receives a temporary UUID4 as their resolved ID."""
    memory = make_memory(tmp_path)

    result = memory.resolve({"SPEAKER_00": np.array([1.0, 0.0, 0.0])})

    assert "SPEAKER_00" in result
    assert _is_valid_uuid(result["SPEAKER_00"]), (
        f"Temporary ID for unrecognized speaker must be a valid UUID, "
        f"got: {result['SPEAKER_00']!r}"
    )


def test_two_speakers_do_not_share_resolved_id(tmp_path):
    """
    Two different SPEAKER_XX must not receive the same resolved ID.
    Greedy matching must assign person_1 to the closest match only.
    """
    memory = make_memory(tmp_path, known={"person_1": [1.0, 0.0, 0.0]})

    result = memory.resolve({
        "SPEAKER_00": np.array([0.99, 0.01, 0.0]),
        "SPEAKER_01": np.array([0.90, 0.44, 0.0]),
    })

    assert result["SPEAKER_00"] != result["SPEAKER_01"], (
        "SPEAKER_00 and SPEAKER_01 received the same resolved ID — greedy matching failed"
    )


def test_best_match_wins_other_gets_new_id(tmp_path):
    """When two speakers compete for one known ID, the highest cosine similarity wins; the other gets a UUID4."""
    memory = make_memory(tmp_path, known={"person_1": [1.0, 0.0, 0.0]})

    result = memory.resolve({
        "SPEAKER_00": np.array([0.99, 0.01, 0.0]),
        "SPEAKER_01": np.array([0.90, 0.44, 0.0]),
    })

    assert result["SPEAKER_00"] == "person_1", "Best match must receive person_1"
    assert _is_valid_uuid(result["SPEAKER_01"]), (
        f"The losing speaker must receive a new UUID4, got: {result['SPEAKER_01']!r}"
    )


def test_two_known_speakers_matched_exclusively(tmp_path):
    """With two known speakers matching two new ones, each must get a unique ID."""
    memory = make_memory(tmp_path, known={
        "person_1": [1.0, 0.0, 0.0],
        "person_2": [0.0, 0.0, 1.0],
    })

    result = memory.resolve({
        "SPEAKER_00": np.array([0.98, 0.0, 0.02]),
        "SPEAKER_01": np.array([0.02, 0.0, 0.98]),
    })

    assert result["SPEAKER_00"] == "person_1"
    assert result["SPEAKER_01"] == "person_2"
    assert result["SPEAKER_00"] != result["SPEAKER_01"]


# ---------------------------------------------------------------------------
# get_name() / set_name()
# ---------------------------------------------------------------------------

def test_get_name_returns_none_when_not_set(tmp_path):
    svc = make_memory(tmp_path)
    assert svc.get_name("Alice") is None


def test_set_and_get_name(tmp_path):
    svc = make_memory(tmp_path)
    svc.set_name("Alice", "Alice Ivanova")
    assert svc.get_name("Alice") == "Alice Ivanova"


def test_get_name_uses_display_label_by_default(tmp_path):
    svc = make_memory(tmp_path)
    svc.set_name("Alice", "Alice Ivanova", label="display")
    assert svc.get_name("Alice") == "Alice Ivanova"
    assert svc.get_name("Alice", label="display") == "Alice Ivanova"


def test_set_name_with_custom_label(tmp_path):
    svc = make_memory(tmp_path)
    svc.set_name("Alice", "@alice_slack", label="slack")
    assert svc.get_name("Alice", label="slack") == "@alice_slack"


def test_get_name_returns_none_for_wrong_label(tmp_path):
    svc = make_memory(tmp_path)
    svc.set_name("Alice", "Alice Ivanova", label="display")
    assert svc.get_name("Alice", label="slack") is None


def test_multiple_labels_for_same_speaker(tmp_path):
    svc = make_memory(tmp_path)
    svc.set_name("Alice", "Alice Ivanova", label="display")
    svc.set_name("Alice", "@alice", label="slack")
    assert svc.get_name("Alice", label="display") == "Alice Ivanova"
    assert svc.get_name("Alice", label="slack") == "@alice"


def test_set_name_overwrites_existing(tmp_path):
    svc = make_memory(tmp_path)
    svc.set_name("Alice", "Old Name")
    svc.set_name("Alice", "New Name")
    assert svc.get_name("Alice") == "New Name"


# ---------------------------------------------------------------------------
# save() / reload() — embedding and name persistence
# ---------------------------------------------------------------------------

def test_save_and_reload_persists_embeddings(tmp_path):
    """save() persists embeddings to SQLite; a new instance reloads them correctly."""
    db = str(tmp_path / "memory.db")
    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)

    svc = SpeakerMemoryService(db_path=db)
    svc.update_embedding("person_1", emb)
    svc.save()

    svc2 = SpeakerMemoryService(db_path=db)
    assert "person_1" in svc2.known_speakers
    assert np.allclose(svc2.known_speakers["person_1"], emb)


def test_save_persists_name(tmp_path):
    svc = make_memory_with_speaker(tmp_path, "Alice")
    svc.set_name("Alice", "Alice Ivanova")
    svc.save()

    svc2 = SpeakerMemoryService(db_path=str(tmp_path / "memory.db"))
    assert svc2.get_name("Alice") == "Alice Ivanova"


def test_reload_restores_multiple_labels(tmp_path):
    svc = make_memory_with_speaker(tmp_path, "Alice")
    svc.set_name("Alice", "Alice Ivanova", label="display")
    svc.set_name("Alice", "@alice", label="slack")
    svc.save()

    svc2 = SpeakerMemoryService(db_path=str(tmp_path / "memory.db"))
    assert svc2.get_name("Alice", label="display") == "Alice Ivanova"
    assert svc2.get_name("Alice", label="slack") == "@alice"


def test_name_not_persisted_without_embedding(tmp_path):
    """set_name() without a matching entry in known_speakers is not saved to DB."""
    svc = make_memory(tmp_path)
    svc.set_name("Ghost", "Ghost Speaker")
    svc.save()

    svc2 = SpeakerMemoryService(db_path=str(tmp_path / "memory.db"))
    assert svc2.get_name("Ghost") is None


def test_names_for_multiple_speakers_all_persisted(tmp_path):
    svc = make_memory(tmp_path)
    svc.update_embedding("Alice", np.array([1.0, 0.0, 0.0], dtype=np.float32))
    svc.update_embedding("Bob",   np.array([0.0, 1.0, 0.0], dtype=np.float32))
    svc.set_name("Alice", "Alice Ivanova")
    svc.set_name("Bob", "Bob Smith")
    svc.save()

    svc2 = SpeakerMemoryService(db_path=str(tmp_path / "memory.db"))
    assert svc2.get_name("Alice") == "Alice Ivanova"
    assert svc2.get_name("Bob") == "Bob Smith"


# ---------------------------------------------------------------------------
# save_names_only()
# ---------------------------------------------------------------------------

def test_save_names_only_persists_name_without_touching_embedding(tmp_path):
    """save_names_only() writes speaker_names but leaves speaker_embeddings bit-for-bit unchanged."""
    db_path = str(tmp_path / "memory.db")
    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)

    svc = SpeakerMemoryService(db_path=db_path)
    svc.update_embedding("spk_aaa", emb)
    svc.save()

    with sqlite3.connect(db_path) as con:
        row = con.execute(
            "SELECT embedding, count FROM speaker_embeddings WHERE id = ?",
            ("spk_aaa",),
        ).fetchone()
    assert row is not None, "embedding must be present after save()"
    blob_before, count_before = row

    svc.set_name("spk_aaa", "Maria")
    svc.save_names_only()

    with sqlite3.connect(db_path) as con:
        name_row = con.execute(
            "SELECT name FROM speaker_names WHERE speaker_id = ? AND label = ?",
            ("spk_aaa", "display"),
        ).fetchone()
    assert name_row is not None, "speaker_names must contain the entry after save_names_only()"
    assert name_row[0] == "Maria"

    with sqlite3.connect(db_path) as con:
        row_after = con.execute(
            "SELECT embedding, count FROM speaker_embeddings WHERE id = ?",
            ("spk_aaa",),
        ).fetchone()
    assert row_after is not None
    blob_after, count_after = row_after
    assert blob_after == blob_before, "save_names_only() must not alter the embedding blob"
    assert count_after == count_before, "save_names_only() must not alter the embedding count"


def test_save_names_only_does_not_create_embedding_rows(tmp_path):
    """save_names_only() with no embedding present must not insert rows into speaker_embeddings."""
    db_path = str(tmp_path / "memory.db")
    svc = SpeakerMemoryService(db_path=db_path)

    svc.set_name("spk_zzz", "Ghost")
    svc.save_names_only()

    with sqlite3.connect(db_path) as con:
        count = con.execute("SELECT COUNT(*) FROM speaker_embeddings").fetchone()[0]
    assert count == 0, "save_names_only() must not write to speaker_embeddings"


def test_save_names_only_overwrites_existing_name(tmp_path):
    """save_names_only() replaces an existing name entry — speaker_names has exactly one row per (speaker_id, label)."""
    db_path = str(tmp_path / "memory.db")
    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)

    svc = SpeakerMemoryService(db_path=db_path)
    svc.update_embedding("spk_aaa", emb)
    svc.save()

    svc.set_name("spk_aaa", "Maria")
    svc.save_names_only()

    svc.set_name("spk_aaa", "Maria K.")
    svc.save_names_only()

    with sqlite3.connect(db_path) as con:
        rows = con.execute(
            "SELECT name FROM speaker_names WHERE speaker_id = ? AND label = ?",
            ("spk_aaa", "display"),
        ).fetchall()

    assert len(rows) == 1, "There must be exactly one speaker_names row per (speaker_id, label)"
    assert rows[0][0] == "Maria K."


# ---------------------------------------------------------------------------
# find_by_name()
# ---------------------------------------------------------------------------

def test_find_by_name_returns_uuid_for_known_name(tmp_path):
    """find_by_name() returns the speaker UUID when the name exists in speaker_names."""
    db_path = str(tmp_path / "memory.db")
    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)

    svc = SpeakerMemoryService(db_path=db_path)
    svc.update_embedding("spk_aaa", emb)
    svc.save()
    svc.set_name("spk_aaa", "Carlos")
    svc.save_names_only()

    svc2 = SpeakerMemoryService(db_path=db_path)
    result = svc2.find_by_name("Carlos")
    assert result == "spk_aaa"


def test_find_by_name_returns_none_when_not_found(tmp_path):
    """find_by_name() returns None when the name does not exist."""
    svc = SpeakerMemoryService(db_path=str(tmp_path / "memory.db"))
    assert svc.find_by_name("NonExistentPerson") is None


def test_find_by_name_returns_none_for_wrong_label(tmp_path):
    """find_by_name() returns None when the name exists but under a different label."""
    db_path = str(tmp_path / "memory.db")
    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)

    svc = SpeakerMemoryService(db_path=db_path)
    svc.update_embedding("spk_aaa", emb)
    svc.save()
    svc.set_name("spk_aaa", "Maria", label="display")
    svc.save_names_only()

    result = svc.find_by_name("Maria", label="nickname")
    assert result is None


# ---------------------------------------------------------------------------
# Migration m001_uuid_speakers — DB helpers
# ---------------------------------------------------------------------------

def _make_legacy_db(db_path: str) -> None:
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


def _make_embedding_blob(seed: int = 0) -> bytes:
    arr = np.array([1.0, float(seed), 0.0], dtype=np.float32)
    return arr.tobytes()


def _insert_legacy_speaker(db_path: str, speaker_id: str, seed: int = 0) -> None:
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO speaker_embeddings (id, embedding, count) VALUES (?, ?, 1)",
            (speaker_id, _make_embedding_blob(seed)),
        )


def _insert_legacy_transcription(db_path: str) -> int:
    with sqlite3.connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO transcriptions (audio_file, language, status) VALUES (?, ?, ?)",
            ("audio.wav", "en", "draft"),
        )
        return cur.lastrowid


def _insert_legacy_segment(db_path: str, transcription_id: int, speaker_id: str) -> int:
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
# Migration m001_uuid_speakers — tests
# ---------------------------------------------------------------------------

def test_legacy_named_speaker_migrated_to_uuid(tmp_path):
    """
    A speaker_embeddings row whose id is a human name (not a UUID) must be
    renamed to a standard UUID4 after _init_db() runs.
    """
    db_path = str(tmp_path / "memory.db")
    _make_legacy_db(db_path)
    _insert_legacy_speaker(db_path, "Smith")
    txn_id = _insert_legacy_transcription(db_path)
    seg_id = _insert_legacy_segment(db_path, txn_id, "Smith")

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


def test_uuid_speaker_not_modified(tmp_path):
    """A speaker_embeddings row whose id already starts with 'spk_' must not be renamed."""
    db_path = str(tmp_path / "memory.db")
    _make_legacy_db(db_path)
    _insert_legacy_speaker(db_path, "spk_abc12345")

    SpeakerMemoryService(db_path=db_path)

    ids = _all_speaker_ids(db_path)
    assert ids == ["spk_abc12345"], (
        f"UUID speaker must be preserved unchanged, got: {ids}"
    )


def test_migration_is_idempotent(tmp_path):
    """
    Running _init_db() twice must produce exactly one speaker_embeddings row
    and exactly one speaker_names row — no duplication.
    """
    db_path = str(tmp_path / "memory.db")
    _make_legacy_db(db_path)
    _insert_legacy_speaker(db_path, "Smith")

    SpeakerMemoryService(db_path=db_path)
    SpeakerMemoryService(db_path=db_path)  # second run — must be a no-op

    ids = _all_speaker_ids(db_path)
    assert len(ids) == 1, f"Expected 1 speaker row, got {len(ids)}: {ids}"

    names = _speaker_names_rows(db_path)
    assert len(names) == 1, f"Expected 1 speaker_names row, got {len(names)}: {names}"


def test_multiple_legacy_speakers_migrated_independently(tmp_path):
    """Two named speakers each receive a distinct UUID4; both display names appear in speaker_names."""
    db_path = str(tmp_path / "memory.db")
    _make_legacy_db(db_path)
    _insert_legacy_speaker(db_path, "Alice", seed=1)
    _insert_legacy_speaker(db_path, "Bob", seed=2)

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


def test_known_speakers_has_uuid_keys_after_migration(tmp_path):
    """After migration, known_speakers must use UUID4 keys — not the original human names."""
    db_path = str(tmp_path / "memory.db")
    _make_legacy_db(db_path)
    _insert_legacy_speaker(db_path, "Smith")

    memory = SpeakerMemoryService(db_path=db_path)

    assert "Smith" not in memory.known_speakers, (
        "Legacy name must not appear as a key in known_speakers"
    )
    uuid_keys = [k for k in memory.known_speakers if _is_valid_uuid(k)]
    assert len(uuid_keys) == 1, (
        f"Expected exactly one UUID4 key in known_speakers, got: {list(memory.known_speakers.keys())}"
    )
