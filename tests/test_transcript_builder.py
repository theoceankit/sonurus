"""Tests for TranscriptBuilder.attach_embeddings() — verifies time-overlap embedding assignment."""

import numpy as np
import pytest
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.transcript_builder import TranscriptBuilder


def make_transcript(*segments):
    return Transcript(segments=list(segments), audio_path="test.wav", language="en")


def make_seg(start, end, text="...", raw="SPEAKER_00"):
    return Segment(start=start, end=end, text=text, speaker_raw=raw)


def make_emb(start, end, speaker="SPEAKER_00"):
    """Embedding entry as returned by EmbeddingService.extract_segments()."""
    return {"start": start, "end": end, "speaker": speaker, "embedding": np.array([start, end, 0.0])}


def test_exact_match_gets_correct_embedding():
    """A segment with exactly matching timestamps gets the correct embedding."""
    seg = make_seg(0.0, 2.0)
    emb = make_emb(0.0, 2.0)

    transcript = make_transcript(seg)
    TranscriptBuilder.attach_embeddings(transcript, [emb])

    assert transcript.segments[0].embedding is not None
    assert np.allclose(transcript.segments[0].embedding, emb["embedding"])


def test_close_segment_gets_nearby_embedding():
    """A slightly time-shifted segment (<0.5s) still gets the nearest embedding."""
    seg = make_seg(0.1, 2.1)
    emb = make_emb(0.0, 2.0)

    transcript = make_transcript(seg)
    TranscriptBuilder.attach_embeddings(transcript, [emb])

    assert transcript.segments[0].embedding is not None
    assert np.allclose(transcript.segments[0].embedding, emb["embedding"])


def test_multiple_segments_each_gets_own_embedding():
    """Each of multiple segments gets its own nearest embedding."""
    seg0 = make_seg(0.0, 2.0)
    seg1 = make_seg(5.0, 7.0)
    emb0 = make_emb(0.0, 2.0)
    emb1 = make_emb(5.0, 7.0)

    transcript = make_transcript(seg0, seg1)
    TranscriptBuilder.attach_embeddings(transcript, [emb0, emb1])

    assert np.allclose(transcript.segments[0].embedding, emb0["embedding"])
    assert np.allclose(transcript.segments[1].embedding, emb1["embedding"])


def test_distant_segment_gets_no_embedding():
    """
    A short segment filtered by extract_segments() has no embedding entry.
    The only available embedding is far away — segment must stay None.
    """
    short_seg = make_seg(10.0, 10.3)
    far_emb = make_emb(0.0, 2.0)

    transcript = make_transcript(short_seg)
    TranscriptBuilder.attach_embeddings(transcript, [far_emb])

    assert transcript.segments[0].embedding is None, (
        "A segment with no overlapping embedding must remain None, "
        "not receive a distant unrelated embedding"
    )


def test_segment_with_no_embeddings_at_all_stays_none():
    """When segment_embeddings is empty, all segments must remain without embedding."""
    seg = make_seg(0.0, 2.0)

    transcript = make_transcript(seg)
    TranscriptBuilder.attach_embeddings(transcript, [])

    assert transcript.segments[0].embedding is None


def test_transcript_segment_inside_diarization_segment_gets_embedding():
    """
    WhisperX produces fine-grained segments [1.2, 2.5] while diarization
    produces a coarser segment [0.0, 10.0]. The transcript segment falls
    inside the diarization segment — it must receive its embedding.
    """
    transcript_seg = make_seg(1.2, 2.5)
    diarization_emb = make_emb(0.0, 10.0)

    transcript = make_transcript(transcript_seg)
    TranscriptBuilder.attach_embeddings(transcript, [diarization_emb])

    assert transcript.segments[0].embedding is not None, (
        "A segment contained within a diarization span must receive its embedding"
    )
