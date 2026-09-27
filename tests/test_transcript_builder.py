"""
Tests for TranscriptBuilder — both build() and attach_embeddings().

Sections:
  - build(): constructs a Transcript from raw WhisperX output + speaker map
  - attach_embeddings(): assigns per-segment embeddings by time overlap
"""

import numpy as np
import pytest
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.transcript_builder import TranscriptBuilder


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def make_transcript(*segments):
    return Transcript(segments=list(segments), audio_path="test.wav", language="en")


def make_seg(start, end, text="...", raw="SPEAKER_00"):
    return Segment(start=start, end=end, text=text, speaker_raw=raw)


def make_emb(start, end, speaker="SPEAKER_00"):
    """Embedding entry as returned by EmbeddingService.extract_segments()."""
    return {"start": start, "end": end, "speaker": speaker, "embedding": np.array([start, end, 0.0])}


def make_result(*segments, language="en"):
    """Minimal WhisperX-style result dict."""
    return {
        "language": language,
        "segments": [
            {
                "start": s["start"],
                "end":   s["end"],
                "text":  s["text"],
                **( {"speaker": s["speaker"]} if "speaker" in s else {} ),
            }
            for s in segments
        ],
    }


def seg(start, end, text, speaker=None):
    d = {"start": start, "end": end, "text": text}
    if speaker is not None:
        d["speaker"] = speaker
    return d


# ---------------------------------------------------------------------------
# build()
# ---------------------------------------------------------------------------

def test_build_creates_correct_segment_count():
    result = make_result(seg(0.0, 2.0, "Hi", "SPEAKER_00"),
                         seg(2.0, 4.0, "Bye", "SPEAKER_01"))
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    assert len(transcript.segments) == 2


def test_build_sets_timestamps_and_text():
    result = make_result(seg(1.5, 3.0, "Hello world", "SPEAKER_00"))
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    s = transcript.segments[0]
    assert s.start == 1.5
    assert s.end == 3.0
    assert s.text == "Hello world"


def test_build_strips_whitespace_from_text():
    result = make_result(seg(0.0, 1.0, "  padded  ", "SPEAKER_00"))
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    assert transcript.segments[0].text == "padded"


def test_build_sets_audio_path_and_language():
    result = make_result(seg(0.0, 1.0, "Hi", "SPEAKER_00"), language="ru")
    transcript = TranscriptBuilder.build(result, {}, "files/meeting.wav")
    assert transcript.audio_path == "files/meeting.wav"
    assert transcript.language == "ru"


def test_build_status_is_draft():
    result = make_result(seg(0.0, 1.0, "Hi", "SPEAKER_00"))
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    assert transcript.status == "draft"


def test_build_speaker_final_starts_as_none():
    result = make_result(seg(0.0, 1.0, "Hi", "SPEAKER_00"))
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    assert transcript.segments[0].speaker_final is None


def test_build_sets_speaker_raw():
    result = make_result(seg(0.0, 2.0, "Hi", "SPEAKER_00"))
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    assert transcript.segments[0].speaker_raw == "SPEAKER_00"


def test_build_applies_speaker_map():
    result = make_result(seg(0.0, 2.0, "Hi", "SPEAKER_00"))
    transcript = TranscriptBuilder.build(result, {"SPEAKER_00": "Alice"}, "audio.wav")
    assert transcript.segments[0].speaker_resolved == "Alice"


def test_build_unmatched_diarization_speaker_gets_its_own_uuid():
    """A SPEAKER_XX without a voice profile match (e.g. too little speech for an
    embedding) still gets a stable UUID — raw labels are never persisted."""
    import uuid
    result = make_result(
        seg(0.0, 1.0, "a", "SPEAKER_98"), seg(1.0, 2.0, "b", "SPEAKER_99"), seg(2.0, 3.0, "c", "SPEAKER_98"),
    )
    segs = TranscriptBuilder.build(result, {"SPEAKER_00": "Alice"}, "audio.wav").segments
    ids = [s.speaker_resolved for s in segs]
    assert uuid.UUID(ids[0]).version == 4 and uuid.UUID(ids[1]).version == 4
    assert ids[0] == ids[2] and ids[0] != ids[1]
    assert not any(s.unassigned for s in segs)
    assert [s.speaker_raw for s in segs] == ["SPEAKER_98", "SPEAKER_99", "SPEAKER_98"]


def test_build_segment_without_diarization_speaker_is_unassigned():
    result = make_result(seg(0.0, 1.0, "Hi"), seg(1.0, 2.0, "Yo", "SPEAKER_00"))
    segs = TranscriptBuilder.build(result, {"SPEAKER_00": "Alice"}, "audio.wav").segments
    assert segs[0].unassigned is True and segs[0].speaker_resolved is None
    assert segs[1].unassigned is False and segs[1].speaker_resolved == "Alice"


def test_build_missing_speaker_field_defaults_to_unknown():
    """Segment without a 'speaker' key gets speaker_raw='UNKNOWN'."""
    result = make_result(seg(0.0, 1.0, "Hi"))  # no speaker key
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    assert transcript.segments[0].speaker_raw == "UNKNOWN"


def test_build_multiple_speakers_all_resolved():
    result = make_result(
        seg(0.0, 2.0, "Hi",  "SPEAKER_00"),
        seg(2.0, 4.0, "Bye", "SPEAKER_01"),
    )
    speaker_map = {"SPEAKER_00": "Alice", "SPEAKER_01": "Bob"}
    transcript = TranscriptBuilder.build(result, speaker_map, "audio.wav")
    assert transcript.segments[0].speaker_resolved == "Alice"
    assert transcript.segments[1].speaker_resolved == "Bob"


def test_build_empty_segments():
    result = {"language": "en", "segments": []}
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    assert transcript.segments == []
    assert transcript.language == "en"


# ---------------------------------------------------------------------------
# attach_embeddings()
# ---------------------------------------------------------------------------

def test_exact_match_gets_correct_embedding():
    """A segment with exactly matching timestamps gets the correct embedding."""
    seg_ = make_seg(0.0, 2.0)
    emb = make_emb(0.0, 2.0)

    transcript = make_transcript(seg_)
    TranscriptBuilder.attach_embeddings(transcript, [emb])

    assert transcript.segments[0].embedding is not None
    assert np.allclose(transcript.segments[0].embedding, emb["embedding"])


def test_close_segment_gets_nearby_embedding():
    """A slightly time-shifted segment (<0.5s) still gets the nearest embedding."""
    seg_ = make_seg(0.1, 2.1)
    emb = make_emb(0.0, 2.0)

    transcript = make_transcript(seg_)
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
    seg_ = make_seg(0.0, 2.0)

    transcript = make_transcript(seg_)
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


# ---------------------------------------------------------------------------
# attach_embeddings(): speaker-aware matching
# A Whisper segment can span a speaker change; the embedding must come from
# the segment's own speaker, or it contaminates that speaker's profile.
# ---------------------------------------------------------------------------

def test_prefers_same_speaker_turn_over_larger_overlap():
    seg_ = make_seg(0.0, 4.0, raw="SPEAKER_00")
    other = make_emb(0.0, 3.0, speaker="SPEAKER_01")   # larger overlap, wrong voice
    own = make_emb(3.0, 4.0, speaker="SPEAKER_00")

    transcript = make_transcript(seg_)
    TranscriptBuilder.attach_embeddings(transcript, [other, own])

    assert np.allclose(transcript.segments[0].embedding, own["embedding"])


def test_no_embedding_when_only_other_speakers_overlap():
    seg_ = make_seg(0.0, 2.0, raw="SPEAKER_00")
    other = make_emb(0.0, 2.0, speaker="SPEAKER_01")

    transcript = make_transcript(seg_)
    TranscriptBuilder.attach_embeddings(transcript, [other])

    assert transcript.segments[0].embedding is None
