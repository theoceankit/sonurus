"""
Tests for TranscriptStorageService.get_embeddings_by_speaker(speaker_id).

The method must:
- Return a list of np.ndarray — all embeddings from the `segments` table
  where speaker_id = ? and embedding IS NOT NULL
- Work across all transcriptions (not just one)
- Return an empty list when the speaker has no segments or all embeddings are NULL
"""

import numpy as np
import pytest
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.transcript_storage_service import TranscriptStorageService


def make_service(tmp_path):
    return TranscriptStorageService(db_path=str(tmp_path / "app.db"))


def make_transcript(segments, audio_path="files/meeting.wav", language="en"):
    return Transcript(audio_path=audio_path, language=language, segments=segments)


# ---------------------------------------------------------------------------
# test 1: returns embeddings for a known speaker
# ---------------------------------------------------------------------------

def test_returns_embeddings_for_known_speaker(tmp_path):
    """Save 1 transcript with 2 segments belonging to speaker A — method returns
    exactly those 2 embedding vectors."""
    svc = make_service(tmp_path)

    emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb2 = np.array([0.8, 0.2, 0.0], dtype=np.float32)

    seg1 = Segment(0.0, 2.0, "Hello", "SPEAKER_00", speaker_resolved="speaker-A", embedding=emb1)
    seg2 = Segment(2.0, 4.0, "World", "SPEAKER_00", speaker_resolved="speaker-A", embedding=emb2)
    # speaker_final overrides resolved — use speaker_final to set effective speaker
    seg1.speaker_final = "speaker-A"
    seg2.speaker_final = "speaker-A"

    svc.save(make_transcript([seg1, seg2]))

    result = svc.get_embeddings_by_speaker("speaker-A")

    assert len(result) == 2
    assert all(isinstance(e, np.ndarray) for e in result)
    vectors = [e.tolist() for e in result]
    assert emb1.tolist() in vectors
    assert emb2.tolist() in vectors


# ---------------------------------------------------------------------------
# test 2: returns empty list for unknown speaker
# ---------------------------------------------------------------------------

def test_returns_empty_for_unknown_speaker(tmp_path):
    """When the requested speaker_id has no segments in the DB, an empty list
    is returned — no exception is raised."""
    svc = make_service(tmp_path)

    seg = Segment(0.0, 2.0, "Hi", "SPEAKER_00", speaker_resolved="speaker-A",
                  embedding=np.array([1.0, 0.0, 0.0], dtype=np.float32))
    seg.speaker_final = "speaker-A"
    svc.save(make_transcript([seg]))

    result = svc.get_embeddings_by_speaker("speaker-NOBODY")

    assert result == []


# ---------------------------------------------------------------------------
# test 3: ignores NULL embeddings
# ---------------------------------------------------------------------------

def test_ignores_null_embeddings(tmp_path):
    """3 segments for speaker A, one of which has embedding=None — only the 2
    non-null embeddings are returned."""
    svc = make_service(tmp_path)

    emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)

    seg1 = Segment(0.0, 1.0, "one",   "SPEAKER_00", speaker_resolved="speaker-A", embedding=emb1)
    seg2 = Segment(1.0, 2.0, "two",   "SPEAKER_00", speaker_resolved="speaker-A", embedding=None)
    seg3 = Segment(2.0, 3.0, "three", "SPEAKER_00", speaker_resolved="speaker-A", embedding=emb2)
    seg1.speaker_final = "speaker-A"
    seg2.speaker_final = "speaker-A"
    seg3.speaker_final = "speaker-A"

    svc.save(make_transcript([seg1, seg2, seg3]))

    result = svc.get_embeddings_by_speaker("speaker-A")

    assert len(result) == 2
    vectors = [e.tolist() for e in result]
    assert emb1.tolist() in vectors
    assert emb2.tolist() in vectors


# ---------------------------------------------------------------------------
# test 4: aggregates across multiple transcriptions
# ---------------------------------------------------------------------------

def test_aggregates_across_transcripts(tmp_path):
    """Speaker A appears in two separate transcriptions — get_embeddings_by_speaker
    returns the embeddings from both transcriptions combined."""
    svc = make_service(tmp_path)

    emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)

    seg1 = Segment(0.0, 2.0, "First", "SPEAKER_00", speaker_resolved="speaker-A", embedding=emb1)
    seg1.speaker_final = "speaker-A"

    seg2 = Segment(0.0, 2.0, "Second", "SPEAKER_00", speaker_resolved="speaker-A", embedding=emb2)
    seg2.speaker_final = "speaker-A"

    svc.save(make_transcript([seg1], audio_path="files/session1.wav"))
    svc.save(make_transcript([seg2], audio_path="files/session2.wav"))

    result = svc.get_embeddings_by_speaker("speaker-A")

    assert len(result) == 2
    vectors = [e.tolist() for e in result]
    assert emb1.tolist() in vectors
    assert emb2.tolist() in vectors


# ---------------------------------------------------------------------------
# test 5: does not return other speakers' embeddings
# ---------------------------------------------------------------------------

def test_does_not_return_other_speakers_embeddings(tmp_path):
    """Transcript contains segments for both speaker A and speaker B. Querying
    by A's ID must not include any of B's embeddings."""
    svc = make_service(tmp_path)

    emb_a = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_b = np.array([0.0, 0.0, 1.0], dtype=np.float32)

    seg_a = Segment(0.0, 2.0, "A speaks", "SPEAKER_00", speaker_resolved="speaker-A", embedding=emb_a)
    seg_b = Segment(2.0, 4.0, "B speaks", "SPEAKER_01", speaker_resolved="speaker-B", embedding=emb_b)
    seg_a.speaker_final = "speaker-A"
    seg_b.speaker_final = "speaker-B"

    svc.save(make_transcript([seg_a, seg_b]))

    result = svc.get_embeddings_by_speaker("speaker-A")

    assert len(result) == 1
    assert np.allclose(result[0], emb_a)
    # confirm B's embedding is absent
    assert not any(np.allclose(e, emb_b) for e in result)
