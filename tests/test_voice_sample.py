"""Tests for pick_voice_sample() — which segment the Speakers page plays."""
import numpy as np

from app.services.voice_sample import pick_voice_sample


def _seg(start, end, emb=None, audio="a.wav", tid=1, text="t"):
    return {"transcription_id": tid, "audio_file": audio, "start": start, "end": end,
            "text": text, "embedding": None if emb is None else np.array(emb, dtype=np.float32)}


EXISTS = lambda path: True


def test_picks_segment_closest_to_the_voice_profile():
    segs = [_seg(0, 5, [0, 1, 0], text="far"), _seg(5, 8, [1, 0.1, 0], text="close")]
    assert pick_voice_sample(segs, np.array([1, 0, 0]), EXISTS)["text"] == "close"


def test_without_profile_picks_the_longest_segment():
    segs = [_seg(0, 3, [1, 0, 0]), _seg(3, 9, [0, 1, 0], text="long")]
    assert pick_voice_sample(segs, None, EXISTS)["text"] == "long"


def test_prefers_segments_of_at_least_two_seconds():
    segs = [_seg(0, 1, [1, 0, 0], text="short"), _seg(1, 3.5, [0, 1, 0], text="ok")]
    assert pick_voice_sample(segs, np.array([1, 0, 0]), EXISTS)["text"] == "ok"


def test_falls_back_to_short_segments_when_nothing_is_long_enough():
    segs = [_seg(0, 0.5, text="a"), _seg(1, 1.8, text="b")]
    assert pick_voice_sample(segs, None, EXISTS)["text"] == "b"


def test_segments_without_embedding_are_ranked_by_length_only():
    segs = [_seg(0, 4, None, text="no-emb"), _seg(4, 6.5, [1, 0, 0], text="emb")]
    assert pick_voice_sample(segs, np.array([1, 0, 0]), EXISTS)["text"] == "emb"
    assert pick_voice_sample([segs[0]], np.array([1, 0, 0]), EXISTS)["text"] == "no-emb"


def test_skips_segments_whose_audio_file_is_missing():
    segs = [_seg(0, 9, [1, 0, 0], audio="gone.wav", text="gone"), _seg(0, 3, [0, 1, 0], audio="here.wav", text="here")]
    assert pick_voice_sample(segs, np.array([1, 0, 0]), lambda p: p == "here.wav")["text"] == "here"


def test_returns_none_when_no_audio_is_available():
    assert pick_voice_sample([_seg(0, 5, audio="gone.wav")], None, lambda p: False) is None
    assert pick_voice_sample([], None, EXISTS) is None


def test_result_shape():
    sample = pick_voice_sample([_seg(1.0, 4.0, [1, 0, 0], audio="x.wav", tid=7, text="hi")], None, EXISTS)
    assert sample == {"transcript_id": 7, "audio_path": "x.wav", "start": 1.0, "end": 4.0, "text": "hi"}
