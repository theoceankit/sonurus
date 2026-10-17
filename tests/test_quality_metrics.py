"""Pure helpers of the quality tests (tests/quality/): text normalisation, WER,
speaker mapping and accuracy, missed utterances, AMI annotation parsing.

The quality tests themselves need real models and are skipped in CI; these
helpers have no ML dependencies, so they are checked here on small inputs.
"""
import math

import numpy as np
import pytest

from tests.quality import ami, metrics


# ── normalisation ────────────────────────────────────────────────────────────

def test_normalize_lowercases_and_strips_punctuation():
    assert metrics.normalize("Hi, I'm David.") == ["hi", "i'm", "david"]


def test_normalize_drops_fillers_and_splits_hyphens():
    assert metrics.normalize("Um, the jog-dial. Mm-hmm. Uh-huh") == ["the", "jog", "dial"]


def test_normalize_keeps_inner_apostrophes_only():
    assert metrics.normalize("'cause it's the users'") == ["cause", "it's", "the", "users"]


def test_normalize_spells_out_numbers_like_the_reference():
    # Whisper writes digits, AMI transcribes spoken words.
    assert metrics.normalize("8, 9, 10 and 25% of 1,250") == [
        "eight", "nine", "ten", "and", "twenty", "five", "percent", "of",
        "one", "thousand", "two", "hundred", "fifty"]
    assert metrics.normalize("a 12.5 euro thing") == ["a", "twelve", "point", "five", "euro", "thing"]


# ── WER ──────────────────────────────────────────────────────────────────────

def test_wer_counts_substitutions_deletions_insertions():
    r = metrics.wer(["a", "b", "c", "d"], ["a", "x", "c", "e", "f"])
    # a=a, b→x (sub), c=c, d→e (sub), +f (ins)
    assert (r.substitutions, r.deletions, r.insertions) == (2, 0, 1)
    assert r.ref_words == 4
    assert r.wer == pytest.approx(3 / 4)


def test_wer_of_identical_text_is_zero_and_empty_hyp_is_all_deletions():
    assert metrics.wer(["a", "b"], ["a", "b"]).wer == 0
    r = metrics.wer(["a", "b"], [])
    assert (r.deletions, r.wer) == (2, 1.0)


def test_alignment_pairs_ref_and_hyp_indices():
    pairs = metrics.align(["a", "b", "c"], ["a", "c"])
    assert ("equal", 0, 0) in pairs
    assert ("delete", 1, None) in pairs
    assert ("equal", 2, 1) in pairs


# ── speakers ─────────────────────────────────────────────────────────────────

REF_TURNS = [  # (speaker, start, end)
    ("ann", 0.0, 10.0),
    ("bob", 10.0, 20.0),
    ("ann", 20.0, 25.0),
]


def test_map_speakers_by_time_overlap_one_to_one():
    hyp_turns = [("S1", 0.0, 9.0), ("S2", 9.0, 21.0), ("S1", 21.0, 25.0), ("S3", 25.0, 26.0)]
    assert metrics.map_speakers(REF_TURNS, hyp_turns) == {"S1": "ann", "S2": "bob", "S3": None}


def test_map_speakers_two_hyp_speakers_for_one_ref_speaker_keeps_the_larger():
    hyp_turns = [("S1", 0.0, 8.0), ("S2", 8.0, 10.0), ("S3", 10.0, 20.0)]
    mapping = metrics.map_speakers(REF_TURNS, hyp_turns)
    assert mapping == {"S1": "ann", "S2": None, "S3": "bob"}


def test_speaker_accuracy_over_aligned_words():
    ref = [metrics.Word("a", 0, 1, "ann"), metrics.Word("b", 1, 2, "bob"), metrics.Word("c", 2, 3, "bob")]
    hyp = [metrics.Word("a", 0, 1, "S1"), metrics.Word("b", 1, 2, "S1"), metrics.Word("c", 2, 3, "S2")]
    acc = metrics.speaker_accuracy(ref, hyp, {"S1": "ann", "S2": "bob"})
    assert acc == pytest.approx(2 / 3)


def test_speaker_accuracy_counts_unmapped_hyp_speaker_as_wrong():
    ref = [metrics.Word("a", 0, 1, "ann")]
    hyp = [metrics.Word("a", 0, 1, "S9")]
    assert metrics.speaker_accuracy(ref, hyp, {"S9": None}) == 0


def test_segment_words_spread_segment_times_over_words():
    words = metrics.segment_words([("S1", 0.0, 4.0, "Hello, big world. Um")])
    assert [w.text for w in words] == ["hello", "big", "world"]
    assert all(w.speaker == "S1" for w in words)
    assert words[0].start == 0.0 and words[-1].end == 4.0


# ── utterances and misses ────────────────────────────────────────────────────

def _w(text, start, speaker="ann"):
    return metrics.Word(text, start, start + 0.3, speaker)


def test_utterances_split_on_speaker_change_and_long_pause():
    words = [_w("a", 0), _w("b", 0.5), _w("c", 3.0), _w("d", 3.4, "bob")]
    utts = metrics.utterances(words, max_gap=1.0)
    assert [[w.text for w in u.words] for u in utts] == [["a", "b"], ["c"], ["d"]]
    assert utts[0].speaker == "ann" and utts[2].speaker == "bob"


def test_missed_utterances_below_half_of_words_found():
    ref = [_w("one", 0), _w("two", 0.4), _w("three", 0.8), _w("four", 5), _w("five", 5.4)]
    hyp = [_w("one", 0), _w("two", 0.4), _w("three", 0.8)]
    utts = metrics.utterances(ref, max_gap=1.0)
    missed = metrics.missed_utterances(ref, hyp, utts)
    assert [[w.text for w in u.words] for u in missed] == [["four", "five"]]


def test_rms_dbfs():
    sr = 16000
    sine = 0.5 * np.sin(2 * np.pi * 440 * np.arange(sr) / sr)
    assert metrics.rms_dbfs(sine) == pytest.approx(20 * math.log10(0.5 / math.sqrt(2)), abs=0.01)
    assert metrics.rms_dbfs(np.zeros(10)) == -math.inf


def test_cosine():
    assert metrics.cosine(np.array([1.0, 0.0]), np.array([1.0, 0.0])) == pytest.approx(1.0)
    assert metrics.cosine(np.array([1.0, 0.0]), np.array([0.0, 2.0])) == pytest.approx(0.0)


def test_recognition_counts_correct_wrong_and_new():
    hyp_to_ref = {"S1": "ann", "S2": "bob", "S3": "cat", "S4": None}
    hyp_to_known = {"S1": "ann", "S2": "ann", "S3": None, "S4": None}
    r = metrics.recognition(hyp_to_ref, hyp_to_known)
    assert (r.correct, r.wrong, r.new) == (1, 1, 1)


# ── AMI annotations ──────────────────────────────────────────────────────────

WORDS_XML = b"""<?xml version="1.0" encoding="ISO-8859-1" standalone="yes"?>
<nite:root nite:id="X.A.words" xmlns:nite="http://nite.sourceforge.net/">
   <w nite:id="w0" starttime="10.0" endtime="10.4">Hi</w>
   <w nite:id="w1" starttime="10.4" endtime="10.4" punc="true">,</w>
   <vocalsound nite:id="w2" starttime="10.5" endtime="10.5" type="laugh"/>
   <w nite:id="w3" starttime="10.6" endtime="11.0">I&#39;m</w>
   <w nite:id="w4">untimed</w>
   <w nite:id="w5" starttime="70.0" endtime="70.5">later</w>
</nite:root>
"""

MEETINGS_XML = b"""<?xml version="1.0" encoding="ISO-8859-1"?>
<nite:root xmlns:nite="http://nite.sourceforge.net/">
   <meeting nite:id="m1" observation="X" duration="100">
      <speaker nite:id="X_2" channel="1" nxt_agent="B" global_name="FEE005"/>
      <speaker nite:id="X_1" channel="0" nxt_agent="A" global_name="MEE006"/>
   </meeting>
   <meeting nite:id="m2" observation="Y" duration="100">
      <speaker nite:id="Y_1" channel="0" nxt_agent="A" global_name="MEE099"/>
   </meeting>
</nite:root>
"""


def test_parse_words_keeps_timed_words_only():
    assert ami.parse_words(WORDS_XML) == [(10.0, 10.4, "Hi"), (10.6, 11.0, "I'm"), (70.0, 70.5, "later")]


def test_parse_meeting_speakers():
    assert ami.parse_meeting_speakers(MEETINGS_XML, "X") == {
        "A": ami.Speaker(agent="A", channel=0, global_name="MEE006"),
        "B": ami.Speaker(agent="B", channel=1, global_name="FEE005"),
    }


def test_window_reference_shifts_times_and_keeps_words_inside():
    words_by_agent = {
        "A": [(5.0, 5.5, "before"), (10.0, 10.4, "Hi"), (19.8, 20.2, "across")],
        "B": [(12.0, 12.5, "Hello")],
    }
    speakers = {"A": ami.Speaker("A", 0, "MEE006"), "B": ami.Speaker("B", 1, "FEE005")}
    ref = ami.window_reference(words_by_agent, speakers, start=10.0, end=20.0)
    assert ref == [
        {"word": "Hi", "start": 0.0, "end": pytest.approx(0.4), "speaker": "MEE006"},
        {"word": "Hello", "start": 2.0, "end": 2.5, "speaker": "FEE005"},
    ]


def test_speech_gate_opens_around_own_speech_with_fades():
    sr = 100  # 100 samples per second keeps the arithmetic readable
    gate = ami.speech_gate(10 * sr, [(2.0, 3.0), (3.2, 4.0)], sr, pad=0.5, fade=0.1)
    assert gate.shape == (1000,)
    assert gate[100] == 0                       # 1.0 s: before 2.0 − 0.5 − fade
    assert gate[150] == pytest.approx(1.0)      # 1.5 s: open (pad)
    assert 0 < gate[145] < 1                    # fade-in just before 1.5 s
    assert gate[310] == pytest.approx(1.0)      # 3.1 s: gap of 0.2 s stays open
    assert gate[449] == pytest.approx(1.0)      # just before 4.5 s: open (pad)
    assert 0 < gate[450] < 1                    # fade-out from 4.5 s
    assert gate[700] == 0                       # 7.0 s: closed


@pytest.mark.parametrize("shift", [0, 480, -320])
def test_estimate_lag_finds_the_shift_of_a_recording(shift):
    rng = np.random.default_rng(0)
    x = rng.standard_normal(16000 * 3)
    y = np.concatenate([np.zeros(shift), x])[: len(x)] if shift >= 0 else x[-shift:]
    assert metrics.estimate_lag(x, 0.5 * y, 16000) == pytest.approx(shift / 16000)


def test_shift_words_moves_times():
    words = [metrics.Word("a", 1.0, 1.5, "S1")]
    assert metrics.shift_words(words, -0.25) == [metrics.Word("a", 0.75, 1.25, "S1")]


def test_speaker_recall_is_the_share_of_each_speakers_words_recognised():
    ref = [_w("a", 0), _w("b", 1), _w("c", 2, "bob"), _w("d", 3, "bob")]
    hyp = [_w("a", 0), _w("b", 1), _w("c", 2, "S2")]
    assert metrics.speaker_recall(ref, hyp) == {"ann": 1.0, "bob": 0.5}
