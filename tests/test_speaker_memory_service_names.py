"""
Tests for SpeakerMemoryService — set_name(), get_name(), and name persistence
through save() / reload.
"""

import numpy as np
import pytest
from app.services.speaker_memory_service import SpeakerMemoryService


def make_memory(tmp_path):
    return SpeakerMemoryService(db_path=str(tmp_path / "memory.db"))


def make_memory_with_speaker(tmp_path, spk_id="Alice"):
    """Memory with one speaker embedding (dirty, ready for save())."""
    svc = make_memory(tmp_path)
    svc.update_embedding(spk_id, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    return svc


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
# Persistence through save() / reload
# ---------------------------------------------------------------------------

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
    import sqlite3

    db_path = str(tmp_path / "memory.db")
    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)

    # Persist an embedding via the normal path first
    svc = SpeakerMemoryService(db_path=db_path)
    svc.update_embedding("spk_aaa", emb)
    svc.save()

    # Capture the raw blob and count from the DB
    with sqlite3.connect(db_path) as con:
        row = con.execute(
            "SELECT embedding, count FROM speaker_embeddings WHERE id = ?",
            ("spk_aaa",),
        ).fetchone()
    assert row is not None, "embedding must be present after save()"
    blob_before, count_before = row

    # Now set a name and persist only names
    svc.set_name("spk_aaa", "Maria")
    svc.save_names_only()

    # Name must be in speaker_names
    with sqlite3.connect(db_path) as con:
        name_row = con.execute(
            "SELECT name FROM speaker_names WHERE speaker_id = ? AND label = ?",
            ("spk_aaa", "display"),
        ).fetchone()
    assert name_row is not None, "speaker_names must contain the entry after save_names_only()"
    assert name_row[0] == "Maria"

    # Embedding and count must be identical to before
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
    import sqlite3

    db_path = str(tmp_path / "memory.db")
    svc = SpeakerMemoryService(db_path=db_path)

    svc.set_name("spk_zzz", "Ghost")
    svc.save_names_only()

    with sqlite3.connect(db_path) as con:
        count = con.execute(
            "SELECT COUNT(*) FROM speaker_embeddings"
        ).fetchone()[0]
    assert count == 0, "save_names_only() must not write to speaker_embeddings"


def test_save_names_only_overwrites_existing_name(tmp_path):
    """save_names_only() replaces an existing name entry — speaker_names has exactly one row per (speaker_id, label)."""
    import sqlite3

    db_path = str(tmp_path / "memory.db")
    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)

    svc = SpeakerMemoryService(db_path=db_path)
    svc.update_embedding("spk_aaa", emb)
    svc.save()

    # First name
    svc.set_name("spk_aaa", "Maria")
    svc.save_names_only()

    # Second name — must overwrite
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

    # Reload from DB — simulates a fresh service instance
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
    # Store under "display" label
    svc.set_name("spk_aaa", "Maria", label="display")
    svc.save_names_only()

    # Query under a different label — must not find it
    result = svc.find_by_name("Maria", label="nickname")
    assert result is None
