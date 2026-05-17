"""
Tests for TranscriptBuilder.build() — constructing a Transcript from
raw WhisperX output and a speaker map.
"""

import pytest
from app.services.transcript_builder import TranscriptBuilder


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
# Basic structure
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


# ---------------------------------------------------------------------------
# Speaker mapping
# ---------------------------------------------------------------------------

def test_build_sets_speaker_raw():
    result = make_result(seg(0.0, 2.0, "Hi", "SPEAKER_00"))
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    assert transcript.segments[0].speaker_raw == "SPEAKER_00"


def test_build_applies_speaker_map():
    result = make_result(seg(0.0, 2.0, "Hi", "SPEAKER_00"))
    transcript = TranscriptBuilder.build(result, {"SPEAKER_00": "Alice"}, "audio.wav")
    assert transcript.segments[0].speaker_resolved == "Alice"


def test_build_unknown_speaker_gets_none_resolved():
    result = make_result(seg(0.0, 2.0, "Hi", "SPEAKER_99"))
    transcript = TranscriptBuilder.build(result, {"SPEAKER_00": "Alice"}, "audio.wav")
    assert transcript.segments[0].speaker_resolved is None


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
