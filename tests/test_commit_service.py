"""Tests for CommitService — verifies per-segment embedding behaviour on manual speaker reassignment."""

import numpy as np
import pytest
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.commit_service import CommitService
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService


def make_services(tmp_path):
    db_path = str(tmp_path / "app.db")
    memory = SpeakerMemoryService(db_path=db_path)
    storage = TranscriptStorageService(db_path=db_path)
    return memory, storage


def test_commit_saves_per_segment_embedding(tmp_path):
    """Each speaker gets the mean embedding of their own segments."""
    emb_a1 = np.array([1.0, 0.0, 0.0])
    emb_a2 = np.array([0.8, 0.2, 0.0])
    emb_b1 = np.array([0.0, 0.0, 1.0])

    transcript = Transcript(segments=[
        Segment(0.0, 2.0, "Hi",    "SPEAKER_00", speaker_resolved="person_1", embedding=emb_a1),
        Segment(2.0, 4.0, "Hello", "SPEAKER_00", speaker_resolved="person_1", embedding=emb_a2),
        Segment(4.0, 6.0, "Bye",   "SPEAKER_01", speaker_resolved="person_2", embedding=emb_b1),
    ])

    memory, storage = make_services(tmp_path)
    storage.save(transcript)
    CommitService(memory, storage).commit(transcript)

    raw_mean = np.mean([emb_a1, emb_a2], axis=0)
    expected_person1 = raw_mean / np.linalg.norm(raw_mean)
    assert np.allclose(memory.known_speakers["person_1"], expected_person1)
    assert np.allclose(memory.known_speakers["person_2"], emb_b1)


def test_reassigned_segment_gets_its_own_embedding(tmp_path):
    """
    A segment initially attributed to person_1 is reassigned to new_person.
    new_person must receive only that segment's embedding, not person_1's average.
    """
    emb_person1_seg0 = np.array([1.0, 0.0, 0.0])
    emb_person1_seg1 = np.array([0.9, 0.1, 0.0])
    emb_other_person = np.array([0.0, 0.0, 1.0])

    seg0 = Segment(0.0, 2.0, "Hi",    "SPEAKER_00", speaker_resolved="person_1", embedding=emb_person1_seg0)
    seg1 = Segment(2.0, 4.0, "Hello", "SPEAKER_00", speaker_resolved="person_1", embedding=emb_person1_seg1)
    seg2 = Segment(4.0, 6.0, "Bye",   "SPEAKER_00", speaker_resolved="person_1", embedding=emb_other_person)
    seg2.speaker_final = "new_person"

    transcript = Transcript(segments=[seg0, seg1, seg2])

    memory, storage = make_services(tmp_path)
    storage.save(transcript)
    CommitService(memory, storage).commit(transcript)

    assert np.allclose(memory.known_speakers["new_person"], emb_other_person), (
        "new_person must have their own unique embedding, not an average of SPEAKER_00"
    )

    raw_mean = np.mean([emb_person1_seg0, emb_person1_seg1], axis=0)
    expected_person1 = raw_mean / np.linalg.norm(raw_mean)
    assert np.allclose(memory.known_speakers["person_1"], expected_person1)

    similarity = np.dot(
        memory.known_speakers["new_person"],
        memory.known_speakers["person_1"]
    )
    assert similarity < 0.5, "Embeddings for new_person and person_1 must differ significantly"


def test_spk_prefix_is_persisted(tmp_path):
    """spk_* IDs must be persisted to speaker memory after commit."""
    emb = np.array([1.0, 0.0, 0.0])

    transcript = Transcript(segments=[
        Segment(0.0, 2.0, "Hi", "SPEAKER_00", speaker_resolved="spk_abc123", embedding=emb),
    ])

    memory, storage = make_services(tmp_path)
    storage.save(transcript)
    CommitService(memory, storage).commit(transcript)

    assert "spk_abc123" in memory.known_speakers
    assert np.allclose(memory.known_speakers["spk_abc123"], emb)


def test_segment_without_embedding_is_skipped(tmp_path):
    """Segments with embedding=None (filtered short clips) must not break commit."""
    emb = np.array([1.0, 0.0, 0.0])

    transcript = Transcript(segments=[
        Segment(0.0, 2.0, "Hi",  "SPEAKER_00", speaker_resolved="person_1", embedding=emb),
        Segment(2.0, 2.3, "Mm",  "SPEAKER_00", speaker_resolved="person_1", embedding=None),
    ])

    memory, storage = make_services(tmp_path)
    storage.save(transcript)
    CommitService(memory, storage).commit(transcript)

    assert np.allclose(memory.known_speakers["person_1"], emb)
