"""Tests for SpeakerMemoryService — verifies resolve() purity and speaker matching correctness."""

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


def make_memory(tmp_path, known=None):
    svc = SpeakerMemoryService(db_path=str(tmp_path / "memory.db"))
    if known:
        svc.known_speakers = {k: np.array(v) for k, v in known.items()}
    return svc


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
    memory = make_memory(tmp_path, known={
        "person_1": [1.0, 0.0, 0.0],
    })

    result = memory.resolve({
        "SPEAKER_00": np.array([0.99, 0.01, 0.0]),
        "SPEAKER_01": np.array([0.90, 0.44, 0.0]),
    })

    assert result["SPEAKER_00"] != result["SPEAKER_01"], (
        "SPEAKER_00 and SPEAKER_01 received the same resolved ID — greedy matching failed"
    )


def test_best_match_wins_other_gets_new_id(tmp_path):
    """When two speakers compete for one known ID, the highest cosine similarity wins; the other gets a UUID4."""
    memory = make_memory(tmp_path, known={
        "person_1": [1.0, 0.0, 0.0],
    })

    result = memory.resolve({
        "SPEAKER_00": np.array([0.99, 0.01, 0.0]),
        "SPEAKER_01": np.array([0.90, 0.44, 0.0]),
    })

    assert result["SPEAKER_00"] == "person_1", \
        "Best match must receive person_1"
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
