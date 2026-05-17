"""
Tests for the refactored CommitService that recomputes speaker embeddings
from all segments stored in the DB (recompute-from-scratch) instead of using
incremental weighted averaging.

New constructor: CommitService(memory_service, storage_service)
New / changed methods:
  - commit(transcript)                  — recomputes from all DB segments
  - commit_speaker(speaker_id)          — takes only ID, reads from DB
  - recompute_or_remove(speaker_id)     — new
  - commit_recognized_speakers(transcript) — new
"""

import numpy as np
import pytest

from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.commit_service import CommitService
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService


# ---------------------------------------------------------------------------
# Factories
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


# ---------------------------------------------------------------------------
# Verify old API (no storage arg) raises TypeError
# ---------------------------------------------------------------------------

def test_old_constructor_without_storage_raises(tmp_path):
    """CommitService(memory) without a storage_service argument must raise
    TypeError — confirming the old single-argument API is no longer supported."""
    db_path = str(tmp_path / "app.db")
    memory = SpeakerMemoryService(db_path=db_path)

    with pytest.raises(TypeError):
        CommitService(memory)


# ===========================================================================
# Group: commit(transcript) — recompute from all DB segments
# ===========================================================================

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
    assert np.allclose(memory.known_speakers[spk], expected, atol=1e-5), (
        f"Expected cross-session mean {expected}, got {memory.known_speakers[spk]}"
    )


def test_commit_does_not_use_incremental_averaging(tmp_path):
    """Calling commit multiple times for the same speaker with the same
    embedding must not cause the stored embedding to drift — the result must
    be identical after 3 consecutive commits.

    This confirms recompute-from-DB semantics: running the same computation
    repeatedly produces the same answer.
    """
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
# Group: commit_speaker(speaker_id) — new signature (no transcript arg)
# ===========================================================================

def test_commit_speaker_takes_only_id(tmp_path):
    """commit_speaker must accept only a speaker_id string (no transcript).
    It reads segments from DB and updates memory for the given speaker."""
    memory, storage, commit_svc = make_services(tmp_path)

    emb = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    spk = "spk-bob"

    seg = make_segment(0.0, 2.0, "Talk", "SPEAKER_00", spk, emb)
    storage.save(make_transcript([seg]))

    # Must not raise; must not require a transcript argument
    commit_svc.commit_speaker(spk)

    assert spk in memory.known_speakers
    assert np.allclose(memory.known_speakers[spk], emb, atol=1e-5)


def test_commit_speaker_aggregates_across_transcripts(tmp_path):
    """commit_speaker(speaker_id) must collect segments from all transcripts
    and compute the mean embedding from scratch."""
    memory, storage, commit_svc = make_services(tmp_path)

    emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    spk = "spk-carol"

    seg1 = make_segment(0.0, 2.0, "First",  "SPEAKER_00", spk, emb1)
    seg2 = make_segment(0.0, 2.0, "Second", "SPEAKER_00", spk, emb2)
    storage.save(make_transcript([seg1], audio_path="files/t1.wav"))
    storage.save(make_transcript([seg2], audio_path="files/t2.wav"))

    commit_svc.commit_speaker(spk)

    raw_mean = np.mean([emb1, emb2], axis=0)
    expected = raw_mean / np.linalg.norm(raw_mean)

    assert np.allclose(memory.known_speakers[spk], expected, atol=1e-5)


# ===========================================================================
# Group: recompute_or_remove(speaker_id) — new method
# ===========================================================================

def test_recompute_or_remove_recomputes_when_segments_remain(tmp_path):
    """When the speaker has segments in DB, recompute_or_remove updates their
    embedding in memory from those segments."""
    memory, storage, commit_svc = make_services(tmp_path)

    emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    spk = "spk-dave"

    # Seed memory with an old embedding
    memory.update_embedding(spk, np.array([0.5, 0.5, 0.0], dtype=np.float32))
    memory.save()

    seg1 = make_segment(0.0, 2.0, "A", "SPEAKER_00", spk, emb1)
    seg2 = make_segment(2.0, 4.0, "B", "SPEAKER_00", spk, emb2)
    storage.save(make_transcript([seg1, seg2]))

    commit_svc.recompute_or_remove(spk)

    raw_mean = np.mean([emb1, emb2], axis=0)
    expected = raw_mean / np.linalg.norm(raw_mean)

    assert spk in memory.known_speakers
    assert np.allclose(memory.known_speakers[spk], expected, atol=1e-5)


def test_recompute_or_remove_removes_unnamed_speaker_with_no_segments(tmp_path):
    """When the speaker has no segments in DB AND no display name in
    speaker_names, recompute_or_remove deletes them from known_speakers."""
    memory, storage, commit_svc = make_services(tmp_path)

    spk = "spk-ghost"
    memory.update_embedding(spk, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    memory.save()

    assert spk in memory.known_speakers

    # No segments saved for this speaker
    commit_svc.recompute_or_remove(spk)

    assert spk not in memory.known_speakers, (
        "Unnamed speaker with no remaining segments must be removed from known_speakers"
    )


def test_recompute_or_remove_keeps_named_speaker_with_no_segments(tmp_path):
    """When the speaker has a display name but no segments, they must NOT be
    removed — a named speaker is 'recognized' and their record is preserved."""
    db_path = str(tmp_path / "app.db")
    memory = SpeakerMemoryService(db_path=db_path)
    storage = TranscriptStorageService(db_path=db_path)

    spk = "spk-named"
    memory.update_embedding(spk, np.array([1.0, 0.0, 0.0], dtype=np.float32))
    # Add a display name directly via the DB so the speaker is "recognized"
    import sqlite3
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO speaker_names (speaker_id, label, name) VALUES (?, 'display', ?)",
            (spk, "Alice"),
        )
    memory.save()

    commit_svc = CommitService(memory, storage)
    commit_svc.recompute_or_remove(spk)

    assert spk in memory.known_speakers, (
        "Named speaker must NOT be removed even when they have no segments"
    )


def test_recompute_or_remove_skips_raw_speaker_label(tmp_path):
    """recompute_or_remove('SPEAKER_00') must be a no-op — raw diarization
    labels are never managed in speaker memory."""
    memory, storage, commit_svc = make_services(tmp_path)

    # Should not raise, should not touch anything
    commit_svc.recompute_or_remove("SPEAKER_00")
    commit_svc.recompute_or_remove("SPEAKER_01")

    assert "SPEAKER_00" not in memory.known_speakers
    assert "SPEAKER_01" not in memory.known_speakers


# ===========================================================================
# Group: commit_recognized_speakers(transcript) — new method
# ===========================================================================

def test_commit_recognized_speakers_updates_existing_speaker(tmp_path):
    """commit_recognized_speakers updates a speaker who was already in memory
    (auto-recognized), aggregating their embedding across all DB sessions.

    Session 0 (pre-existing in memory): emb=[1,0,0]
    Session 1 (new, auto-recognized, in DB): emb=[0,1,0]
    Expected: mean of both, normalized.
    """
    db_path = str(tmp_path / "app.db")
    memory = SpeakerMemoryService(db_path=db_path)
    storage = TranscriptStorageService(db_path=db_path)

    spk = "spk-recognized"
    emb_old = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_new = np.array([0.0, 1.0, 0.0], dtype=np.float32)

    # Pre-populate memory with session 0 embedding
    memory.update_embedding(spk, emb_old)
    memory.save()

    # Save session 0 segment to DB so it participates in the recompute
    seg_old = make_segment(0.0, 2.0, "Old", "SPEAKER_00", spk, emb_old)
    storage.save(make_transcript([seg_old], audio_path="files/session0.wav"))

    # New transcript: speaker auto-recognized (speaker_resolved set, no speaker_final)
    seg_new = Segment(0.0, 2.0, "New", "SPEAKER_00",
                      speaker_resolved=spk, embedding=emb_new)
    new_transcript = make_transcript([seg_new], audio_path="files/session1.wav")
    storage.save(new_transcript)

    commit_svc = CommitService(memory, storage)
    commit_svc.commit_recognized_speakers(new_transcript)

    raw_mean = np.mean([emb_old, emb_new], axis=0)
    expected = raw_mean / np.linalg.norm(raw_mean)

    assert np.allclose(memory.known_speakers[spk], expected, atol=1e-5), (
        f"Expected cross-session mean {expected}, got {memory.known_speakers[spk]}"
    )


def test_commit_recognized_speakers_skips_new_speakers(tmp_path):
    """commit_recognized_speakers must NOT add speakers that are not already
    in memory. Only known (previously committed) speakers are updated."""
    memory, storage, commit_svc = make_services(tmp_path)

    spk_known = "spk-known"
    spk_new   = "spk-brand-new"

    emb_known = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_new   = np.array([0.0, 1.0, 0.0], dtype=np.float32)

    # Pre-populate memory with known speaker only
    memory.update_embedding(spk_known, emb_known)
    memory.save()

    seg_known = make_segment(0.0, 2.0, "A speaks", "SPEAKER_00", spk_known, emb_known)
    seg_new   = Segment(2.0, 4.0, "B speaks", "SPEAKER_01",
                        speaker_resolved=spk_new, embedding=emb_new)

    transcript = make_transcript([seg_known, seg_new])
    storage.save(transcript)

    commit_svc.commit_recognized_speakers(transcript)

    assert spk_new not in memory.known_speakers, (
        "New speaker must not be added to memory by commit_recognized_speakers"
    )
    assert spk_known in memory.known_speakers


def test_commit_recognized_speakers_skips_raw_labels(tmp_path):
    """Segments with raw diarization labels (SPEAKER_XX) that were never
    resolved must be ignored by commit_recognized_speakers. Only the already-
    recognized speaker is updated."""
    db_path = str(tmp_path / "app.db")
    memory = SpeakerMemoryService(db_path=db_path)
    storage = TranscriptStorageService(db_path=db_path)

    spk = "spk-recognized"
    emb_spk = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_raw = np.array([0.0, 0.0, 1.0], dtype=np.float32)

    # Only the recognized speaker is pre-seeded in memory
    memory.update_embedding(spk, emb_spk)
    memory.save()

    # Segment with a raw label — was never resolved to a UUID
    seg_raw = Segment(0.0, 2.0, "Raw segment", "SPEAKER_00", embedding=emb_raw)
    # Recognized segment
    seg_rec = Segment(2.0, 4.0, "Recognized", "SPEAKER_01",
                      speaker_resolved=spk, embedding=emb_spk)

    transcript = make_transcript([seg_raw, seg_rec])
    storage.save(transcript)

    commit_svc = CommitService(memory, storage)
    commit_svc.commit_recognized_speakers(transcript)

    # Raw SPEAKER_00 must never appear in memory
    assert "SPEAKER_00" not in memory.known_speakers
    # Recognized speaker must be updated
    assert spk in memory.known_speakers
