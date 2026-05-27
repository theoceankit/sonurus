"""Tests for CommitService — embedding recompute semantics and all public methods.

Groups:
  - commit(transcript)               — per-segment embedding, speaker_final priority,
                                       recompute-from-DB, idempotency
  - commit_speaker(speaker_id)       — single-speaker recompute by ID
  - commit_new_speakers(transcript)  — adds speakers absent from memory
  - commit_recognized_speakers(transcript) — updates speakers already in memory
  - recompute_or_remove(speaker_id)  — post-reassign cleanup
  - API: old single-arg constructor must raise TypeError
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
# Shared factories
# ---------------------------------------------------------------------------

def make_services(tmp_path):
    """Return (memory, storage, commit_svc) sharing a single DB file."""
    db_path = str(tmp_path / "app.db")
    memory = SpeakerMemoryService(db_path=db_path)
    storage = TranscriptStorageService(db_path=db_path)
    commit_svc = CommitService(memory, storage)
    return memory, storage, commit_svc


def make_segment(start, end, text, raw, speaker_id, emb):
    """Helper: create a segment whose effective speaker is speaker_id."""
    seg = Segment(start, end, text, raw, speaker_resolved=speaker_id, embedding=emb)
    seg.speaker_final = speaker_id
    return seg


def make_transcript(segments, audio_path="files/session.wav", language="en"):
    return Transcript(audio_path=audio_path, language=language, segments=segments)


# ===========================================================================
# API contract: old single-arg constructor must raise TypeError
# ===========================================================================

def test_old_constructor_without_storage_raises(tmp_path):
    """CommitService(memory) without a storage_service argument must raise
    TypeError — confirming the old single-argument API is no longer supported."""
    db_path = str(tmp_path / "app.db")
    memory = SpeakerMemoryService(db_path=db_path)
    with pytest.raises(TypeError):
        CommitService(memory)


# ===========================================================================
# Group: commit(transcript) — embedding computation and priority
# ===========================================================================

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

    memory, storage, commit_svc = make_services(tmp_path)
    storage.save(transcript)
    commit_svc.commit(transcript)

    raw_mean = np.mean([emb_a1, emb_a2], axis=0)
    expected_person1 = raw_mean / np.linalg.norm(raw_mean)
    assert np.allclose(memory.known_speakers["person_1"], expected_person1)
    assert np.allclose(memory.known_speakers["person_2"], emb_b1)


def test_reassigned_segment_gets_its_own_embedding(tmp_path):
    """A segment initially attributed to person_1 is reassigned to new_person via
    speaker_final. new_person must receive only that segment's embedding."""
    emb_person1_seg0 = np.array([1.0, 0.0, 0.0])
    emb_person1_seg1 = np.array([0.9, 0.1, 0.0])
    emb_other_person = np.array([0.0, 0.0, 1.0])

    seg0 = Segment(0.0, 2.0, "Hi",    "SPEAKER_00", speaker_resolved="person_1", embedding=emb_person1_seg0)
    seg1 = Segment(2.0, 4.0, "Hello", "SPEAKER_00", speaker_resolved="person_1", embedding=emb_person1_seg1)
    seg2 = Segment(4.0, 6.0, "Bye",   "SPEAKER_00", speaker_resolved="person_1", embedding=emb_other_person)
    seg2.speaker_final = "new_person"

    transcript = Transcript(segments=[seg0, seg1, seg2])

    memory, storage, commit_svc = make_services(tmp_path)
    storage.save(transcript)
    commit_svc.commit(transcript)

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

    memory, storage, commit_svc = make_services(tmp_path)
    storage.save(transcript)
    commit_svc.commit(transcript)

    assert "spk_abc123" in memory.known_speakers
    assert np.allclose(memory.known_speakers["spk_abc123"], emb)


def test_segment_without_embedding_is_skipped(tmp_path):
    """Segments with embedding=None (filtered short clips) must not break commit."""
    emb = np.array([1.0, 0.0, 0.0])
    transcript = Transcript(segments=[
        Segment(0.0, 2.0, "Hi",  "SPEAKER_00", speaker_resolved="person_1", embedding=emb),
        Segment(2.0, 2.3, "Mm",  "SPEAKER_00", speaker_resolved="person_1", embedding=None),
    ])

    memory, storage, commit_svc = make_services(tmp_path)
    storage.save(transcript)
    commit_svc.commit(transcript)

    assert np.allclose(memory.known_speakers["person_1"], emb)


def test_commit_aggregates_from_db_not_only_current_session(tmp_path):
    """commit(transcript) must aggregate embeddings from ALL transcripts in DB,
    not only the segments in the passed transcript.

    Session 1: speaker A, emb=[1, 0, 0] — saved to DB.
    Session 2: speaker A, emb=[0, 1, 0] — saved to DB, then commit(session_2).
    Expected embedding = mean([1,0,0], [0,1,0]) normalised.
    """
    memory, storage, commit_svc = make_services(tmp_path)

    emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    spk = "spk-alice"

    t1 = make_transcript([make_segment(0.0, 2.0, "Hi",    "SPEAKER_00", spk, emb1)],
                         audio_path="files/s1.wav")
    t2 = make_transcript([make_segment(0.0, 2.0, "Hello", "SPEAKER_00", spk, emb2)],
                         audio_path="files/s2.wav")

    storage.save(t1)
    storage.save(t2)
    commit_svc.commit(t2)

    raw_mean = np.mean([emb1, emb2], axis=0)
    expected = raw_mean / np.linalg.norm(raw_mean)

    assert spk in memory.known_speakers
    assert np.allclose(memory.known_speakers[spk], expected, atol=1e-5)


def test_commit_does_not_use_incremental_averaging(tmp_path):
    """Calling commit multiple times for the same speaker must produce the same
    result — confirms recompute-from-DB semantics (no drift)."""
    memory, storage, commit_svc = make_services(tmp_path)

    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    spk = "spk-stable"

    transcript = make_transcript([make_segment(0.0, 2.0, "Talk", "SPEAKER_00", spk, emb)])
    storage.save(transcript)

    commit_svc.commit(transcript)
    first_result = memory.known_speakers[spk].copy()
    commit_svc.commit(transcript)
    second_result = memory.known_speakers[spk].copy()
    commit_svc.commit(transcript)
    third_result = memory.known_speakers[spk].copy()

    assert np.allclose(first_result, second_result, atol=1e-6), (
        "Second commit drifted from first — incremental averaging detected"
    )
    assert np.allclose(first_result, third_result, atol=1e-6), (
        "Third commit drifted from first — incremental averaging detected"
    )


# ===========================================================================
# Group: commit_speaker(speaker_id) — single-speaker recompute by ID
# ===========================================================================

def test_commit_speaker_takes_only_id(tmp_path):
    """commit_speaker must accept only a speaker_id string (no transcript arg)."""
    memory, storage, commit_svc = make_services(tmp_path)

    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    spk = "spk-bob"

    seg = make_segment(0.0, 2.0, "Talk", "SPEAKER_00", spk, emb)
    storage.save(make_transcript([seg]))
    commit_svc.commit_speaker(spk)

    assert spk in memory.known_speakers
    assert np.allclose(memory.known_speakers[spk], emb, atol=1e-5)


def test_commit_speaker_aggregates_across_transcripts(tmp_path):
    """commit_speaker(speaker_id) collects segments from all transcripts."""
    memory, storage, commit_svc = make_services(tmp_path)

    emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    spk = "spk-carol"

    storage.save(make_transcript([make_segment(0.0, 2.0, "First",  "SPEAKER_00", spk, emb1)],
                                 audio_path="files/t1.wav"))
    storage.save(make_transcript([make_segment(0.0, 2.0, "Second", "SPEAKER_00", spk, emb2)],
                                 audio_path="files/t2.wav"))
    commit_svc.commit_speaker(spk)

    raw_mean = np.mean([emb1, emb2], axis=0)
    expected = raw_mean / np.linalg.norm(raw_mean)
    assert np.allclose(memory.known_speakers[spk], expected, atol=1e-5)


# ===========================================================================
# Group: commit_new_speakers(transcript) — adds speakers absent from memory
# ===========================================================================

def test_commit_new_speakers_adds_speakers_absent_from_memory(tmp_path):
    """commit_new_speakers() must add speakers NOT already in memory.

    Two speakers in a transcript: one pre-existing (known), one brand-new.
    Only the brand-new speaker must be added.
    """
    memory, storage, commit_svc = make_services(tmp_path)

    spk_known = "spk-already-known"
    spk_new   = "spk-brand-new"
    emb_known = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_new   = np.array([0.0, 1.0, 0.0], dtype=np.float32)

    memory.update_embedding(spk_known, emb_known)
    memory.save()

    seg_known = make_segment(0.0, 2.0, "A speaks", "SPEAKER_00", spk_known, emb_known)
    seg_new   = make_segment(2.0, 4.0, "B speaks", "SPEAKER_01", spk_new,   emb_new)
    transcript = make_transcript([seg_known, seg_new])
    storage.save(transcript)

    commit_svc.commit_new_speakers(transcript)

    assert spk_new in memory.known_speakers, (
        "Brand-new speaker must be added to memory by commit_new_speakers()"
    )
    assert np.allclose(memory.known_speakers[spk_new], emb_new, atol=1e-5)


def test_commit_new_speakers_does_not_re_commit_known_speaker(tmp_path):
    """commit_new_speakers() must NOT overwrite embeddings for speakers already in memory."""
    memory, storage, commit_svc = make_services(tmp_path)

    spk_known = "spk-stable"
    emb_old         = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_new_session = np.array([0.0, 1.0, 0.0], dtype=np.float32)

    memory.update_embedding(spk_known, emb_old)
    memory.save()

    seg = make_segment(0.0, 2.0, "Talk", "SPEAKER_00", spk_known, emb_new_session)
    storage.save(make_transcript([seg]))
    commit_svc.commit_new_speakers(make_transcript([seg]))

    assert np.allclose(memory.known_speakers[spk_known], emb_old, atol=1e-5), (
        "Known speaker embedding must not be overwritten by commit_new_speakers()"
    )


def test_commit_new_speakers_skips_raw_speaker_labels(tmp_path):
    """commit_new_speakers() must never add SPEAKER_XX labels to memory."""
    memory, storage, commit_svc = make_services(tmp_path)

    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    seg = Segment(0.0, 2.0, "Raw", "SPEAKER_00", embedding=emb)
    transcript = make_transcript([seg])
    storage.save(transcript)
    commit_svc.commit_new_speakers(transcript)

    assert "SPEAKER_00" not in memory.known_speakers


def test_commit_new_speakers_aggregates_from_db_not_only_current_session(tmp_path):
    """commit_new_speakers() reads ALL DB segments for the new speaker, not just
    those in the current transcript, when computing the embedding."""
    memory, storage, commit_svc = make_services(tmp_path)

    spk_new = "spk-fresh"
    emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)

    t1 = make_transcript([make_segment(0.0, 2.0, "First",  "SPEAKER_00", spk_new, emb1)],
                         audio_path="files/s1.wav")
    t2 = make_transcript([make_segment(0.0, 2.0, "Second", "SPEAKER_00", spk_new, emb2)],
                         audio_path="files/s2.wav")

    storage.save(t1)
    storage.save(t2)
    commit_svc.commit_new_speakers(t2)

    raw_mean = np.mean([emb1, emb2], axis=0)
    expected = raw_mean / np.linalg.norm(raw_mean)
    assert spk_new in memory.known_speakers
    assert np.allclose(memory.known_speakers[spk_new], expected, atol=1e-5)


# ===========================================================================
# Group: commit_recognized_speakers(transcript) — updates speakers in memory
# ===========================================================================

def test_commit_recognized_speakers_updates_existing_speaker(tmp_path):
    """commit_recognized_speakers updates a speaker already in memory,
    aggregating their embedding across all DB sessions."""
    db_path = str(tmp_path / "app.db")
    memory  = SpeakerMemoryService(db_path=db_path)
    storage = TranscriptStorageService(db_path=db_path)

    spk     = "spk-recognized"
    emb_old = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_new = np.array([0.0, 1.0, 0.0], dtype=np.float32)

    memory.update_embedding(spk, emb_old)
    memory.save()

    seg_old = make_segment(0.0, 2.0, "Old", "SPEAKER_00", spk, emb_old)
    storage.save(make_transcript([seg_old], audio_path="files/session0.wav"))

    seg_new      = Segment(0.0, 2.0, "New", "SPEAKER_00", speaker_resolved=spk, embedding=emb_new)
    new_transcript = make_transcript([seg_new], audio_path="files/session1.wav")
    storage.save(new_transcript)

    CommitService(memory, storage).commit_recognized_speakers(new_transcript)

    raw_mean = np.mean([emb_old, emb_new], axis=0)
    expected = raw_mean / np.linalg.norm(raw_mean)
    assert np.allclose(memory.known_speakers[spk], expected, atol=1e-5)


def test_commit_recognized_speakers_skips_new_speakers(tmp_path):
    """commit_recognized_speakers must NOT add speakers not already in memory."""
    memory, storage, commit_svc = make_services(tmp_path)

    spk_known = "spk-known"
    spk_new   = "spk-brand-new"
    emb_known = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_new   = np.array([0.0, 1.0, 0.0], dtype=np.float32)

    memory.update_embedding(spk_known, emb_known)
    memory.save()

    seg_known = make_segment(0.0, 2.0, "A speaks", "SPEAKER_00", spk_known, emb_known)
    seg_new   = Segment(2.0, 4.0, "B speaks", "SPEAKER_01",
                        speaker_resolved=spk_new, embedding=emb_new)

    transcript = make_transcript([seg_known, seg_new])
    storage.save(transcript)
    commit_svc.commit_recognized_speakers(transcript)

    assert spk_new not in memory.known_speakers
    assert spk_known in memory.known_speakers


def test_commit_recognized_speakers_skips_raw_labels(tmp_path):
    """Segments with raw diarization labels (SPEAKER_XX) must be ignored."""
    db_path = str(tmp_path / "app.db")
    memory  = SpeakerMemoryService(db_path=db_path)
    storage = TranscriptStorageService(db_path=db_path)

    spk     = "spk-recognized"
    emb_spk = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_raw = np.array([0.0, 0.0, 1.0], dtype=np.float32)

    memory.update_embedding(spk, emb_spk)
    memory.save()

    seg_raw = Segment(0.0, 2.0, "Raw segment", "SPEAKER_00", embedding=emb_raw)
    seg_rec = Segment(2.0, 4.0, "Recognized",  "SPEAKER_01",
                      speaker_resolved=spk, embedding=emb_spk)

    transcript = make_transcript([seg_raw, seg_rec])
    storage.save(transcript)
    CommitService(memory, storage).commit_recognized_speakers(transcript)

    assert "SPEAKER_00" not in memory.known_speakers
    assert spk in memory.known_speakers


# ===========================================================================
# Group: recompute_or_remove(speaker_id) — post-reassign cleanup
# ===========================================================================

def test_recompute_or_remove_recomputes_when_segments_remain(tmp_path):
    """When the speaker has segments in DB, recompute_or_remove updates their embedding."""
    memory, storage, commit_svc = make_services(tmp_path)

    emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    spk  = "spk-dave"

    memory.update_embedding(spk, np.array([0.5, 0.5, 0.0], dtype=np.float32))
    memory.save()

    storage.save(make_transcript([
        make_segment(0.0, 2.0, "A", "SPEAKER_00", spk, emb1),
        make_segment(2.0, 4.0, "B", "SPEAKER_00", spk, emb2),
    ]))
    commit_svc.recompute_or_remove(spk)

    raw_mean = np.mean([emb1, emb2], axis=0)
    expected = raw_mean / np.linalg.norm(raw_mean)
    assert spk in memory.known_speakers
    assert np.allclose(memory.known_speakers[spk], expected, atol=1e-5)


def test_recompute_or_remove_removes_unnamed_speaker_with_no_segments(tmp_path):
    """Speaker with no segments AND no display name must be removed from memory."""
    memory, storage, commit_svc = make_services(tmp_path)

    spk = "spk-ghost"
    memory.update_embedding(spk, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    memory.save()

    commit_svc.recompute_or_remove(spk)

    assert spk not in memory.known_speakers


def test_recompute_or_remove_keeps_named_speaker_with_no_segments(tmp_path):
    """A speaker with a display name must NOT be removed even with no segments."""
    db_path = str(tmp_path / "app.db")
    memory  = SpeakerMemoryService(db_path=db_path)
    storage = TranscriptStorageService(db_path=db_path)

    spk = "spk-named"
    memory.update_embedding(spk, np.array([1.0, 0.0, 0.0], dtype=np.float32))

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO speaker_names (speaker_id, label, name) VALUES (?, 'display', ?)",
            (spk, "Alice"),
        )
    memory.save()

    CommitService(memory, storage).recompute_or_remove(spk)

    assert spk in memory.known_speakers


def test_recompute_or_remove_skips_raw_speaker_label(tmp_path):
    """recompute_or_remove('SPEAKER_00') must be a no-op."""
    memory, storage, commit_svc = make_services(tmp_path)

    commit_svc.recompute_or_remove("SPEAKER_00")
    commit_svc.recompute_or_remove("SPEAKER_01")

    assert "SPEAKER_00" not in memory.known_speakers
    assert "SPEAKER_01" not in memory.known_speakers
