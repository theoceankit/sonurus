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


# ── segments ─────────────────────────────────────────────────────────────────

def test_unassigned_segments_count_and_duration():
    segments = [("S1", 0.0, 2.0, "a b"), (None, 2.0, 3.5, "c"), ("S2", 3.5, 5.0, "d"), (None, 5.0, 5.5, "")]
    assert metrics.unassigned_segments(segments) == (2, pytest.approx(2.0))
    assert metrics.unassigned_segments([("S1", 0.0, 1.0, "a")]) == (0, 0.0)


def test_mixed_segments_counts_segments_with_words_of_two_reference_speakers():
    ref = [_w("hello", 0, "ann"), _w("there", 0.4, "ann"), _w("yes", 0.8, "bob"),
           _w("so", 2.0, "bob"), _w("well", 2.4, "bob")]
    segments = [("S1", 0.0, 1.2, "Hello there, yes."),   # ann ann bob: mixed, one minority word
                ("S2", 2.0, 2.8, "So well.")]            # bob bob: not mixed
    m = metrics.mixed_segments(ref, segments)
    assert (m.segments, m.mixed, m.minority_words) == (2, 1, 1)


def test_mixed_segments_ignores_words_not_matched_to_the_reference():
    # "yep" is a substitution for bob's "yes": not counted, so the segment stays one speaker's;
    # "extra" is inserted and has no reference speaker at all.
    ref = [_w("hello", 0, "ann"), _w("there", 0.4, "ann"), _w("yes", 0.8, "bob")]
    m = metrics.mixed_segments(ref, [("S1", 0.0, 1.2, "Hello there yep extra")])
    assert (m.segments, m.mixed, m.minority_words) == (1, 0, 0)


def test_mixed_segments_minority_is_everyone_but_the_segments_main_speaker():
    ref = [_w("a", 0, "ann"), _w("b", 0.4, "bob"), _w("c", 0.8, "ann"), _w("d", 1.2, "cid"),
           _w("e", 1.6, "ann")]
    m = metrics.mixed_segments(ref, [("S1", 0.0, 2.0, "a b c d e"), (None, 2.0, 2.5, "")])
    assert (m.segments, m.mixed, m.minority_words) == (2, 1, 2)


def test_short_utterance_speakers_counts_recognised_one_and_two_word_utterances():
    ref = [_w("one", 0, "ann"), _w("two", 0.4, "ann"), _w("three", 0.8, "ann"),  # 3 words: not short
           _w("yeah", 3.0, "bob"),                                                # right
           _w("okay", 6.0, "cid"), _w("sure", 6.4, "cid"),                        # one word found, wrong
           _w("right", 9.0, "bob")]                                               # not recognised
    hyp = [_w("one", 0, "S1"), _w("two", 0.4, "S1"), _w("three", 0.8, "S1"),
           _w("yeah", 3.0, "S2"), _w("okay", 6.0, "S1")]
    mapping = {"S1": "ann", "S2": "bob"}
    utts = metrics.utterances(ref)
    assert metrics.short_utterance_speakers(ref, hyp, mapping, utts) == (1, 2)


def test_short_utterance_speakers_needs_every_found_word_right():
    ref = [_w("oh", 0, "bob"), _w("okay", 0.4, "bob")]
    hyp = [_w("oh", 0, "S2"), _w("okay", 0.4, "S1")]
    utts = metrics.utterances(ref)
    # "oh" is a filler only after normalize(); here the words are taken as they are
    assert metrics.short_utterance_speakers(ref, hyp, {"S1": "ann", "S2": "bob"}, utts) == (0, 1)
    assert metrics.short_utterance_speakers(ref, [], {}, utts) == (0, 0)


def test_segment_shape_counts_segments_without_words_empty_and_long():
    raw = [
        {"start": 0.0, "end": 3.0, "text": " Hello there.", "words": [
            {"word": "Hello", "start": 0.1, "end": 0.5}, {"word": "there.", "start": 0.6, "end": 1.0}]},
        {"start": 3.0, "end": 33.0, "text": "", "words": []},                 # empty, no words, long
        {"start": 33.0, "end": 48.0, "text": " Exactly fifteen.", "words": [  # 15 s is not longer
            {"word": "Exactly", "start": 33.0, "end": 33.4}, {"word": "fifteen.", "start": 33.5, "end": 34}]},
        {"start": 48.0, "end": 64.0, "text": " 2024", "words": [{"word": "2024"}]},  # untimed words only, long
        {"start": 64.0, "end": 65.0, "text": "   "},                          # blank, no words key
    ]
    s = metrics.segment_shape(raw)
    assert (s.segments, s.no_words, s.empty_text, s.long) == (5, 3, 2, 2)
    assert metrics.segment_shape(raw, long_seconds=10).long == 3


# ── harness and report ───────────────────────────────────────────────────────

def test_segment_scores_of_a_clip_and_their_totals_in_the_report(monkeypatch):
    from tests.quality import harness, report

    ref = [_w("hello", 0, "ann"), _w("there", 0.4, "ann"), _w("yes", 0.8, "bob"), _w("yeah", 5.0, "bob")]
    segments = [("S1", 0.0, 1.2, "Hello there, yes."), (None, 5.0, 5.5, "Yeah.")]
    hyp = metrics.segment_words(segments)
    raw = [{"start": 0.0, "end": 1.2, "text": " Hello there, yes.", "words": [{"word": "Hello", "start": 0.0}]},
           {"start": 1.2, "end": 20.0, "text": "", "words": []}]
    scores = harness.segment_scores(ref, segments, hyp, {"S1": "ann"}, metrics.utterances(ref), raw)
    assert scores == {
        "segments": 2, "unassigned": 1, "unassigned_s": 0.5, "mixed": 1, "mixed_minority_words": 1,
        # short: "hello there" right; "yes" inside ann's segment and "yeah" unassigned, wrong
        "short_right": 1, "short_found": 3,
        "raw_segments": 2, "no_words": 1, "empty_text": 1, "long_segments": 1,
    }

    clip = {"clip": "es2002b", "language": "en", "wer": 0.1, "errors": 1, "ref_words": 10, "sub": 1, "del": 0,
            "ins": 0, "ref_speakers": 2, "hyp_speakers": 1, "speaker_acc": 0.75, "recall_by_speaker": {},
            "utterances": 1, "missed": 0, "short": 1, "missed_short": 0, "missed_level": [],
            "found_level_median": -30.0, "missed_text": [], "lag": 0.0, "seconds": 1.0, "named_here": True,
            **scores}
    total = harness._totals(harness.Variant("v", "clean.wav"), [clip, {**clip, "clip": "es2002c"}])
    assert (total["segments"], total["unassigned_s"], total["long_segments"]) == (4, 1.0, 2)

    monkeypatch.setattr(report, "ROWS", [{**total, "what": "", "base": None, "series": None}])
    text = report.markdown()
    assert "## Segments" in text
    assert "| v | all | 2 (1.0) | 2 / 4 (2) | 2 / 6 (33.3%) | 2 | 2 | 2 / 4 |" in text
    assert "| v | es2002b | 1 (0.5) | 1 / 2 (1) | 1 / 3 (33.3%) | 1 | 1 | 1 / 2 |" in text
