"""rank_candidates and voice_centroid: which known speakers an unknown voice may be."""
import math

import numpy as np
import pytest

from app.services.speaker_candidates import rank_candidates, voice_centroid


def _vec(*v):
    return np.array(v, dtype=np.float32)


def _at_cosine(cos):
    """A unit vector whose cosine similarity to VOICE is cos."""
    return _vec(cos, math.sqrt(1 - cos * cos), 0.0)


VOICE = _vec(1.0, 0.0, 0.0)


def _rank(cosines, **kwargs):
    """cosines: {speaker id: similarity to VOICE}; a speaker's name is its id in capitals."""
    profiles = {spk: _at_cosine(cos) for spk, cos in cosines.items()}
    return rank_candidates(VOICE, profiles, {spk: spk.upper() for spk in cosines}, **kwargs)


def test_candidates_are_sorted_by_similarity_with_their_names():
    assert _rank({"a": 0.3, "b": 0.8, "c": 0.6}) == [
        {"speaker_id": "b", "name": "B", "score": 0.8, "suggested": True},
        {"speaker_id": "c", "name": "C", "score": 0.6, "suggested": False},
        {"speaker_id": "a", "name": "A", "score": 0.3, "suggested": False},
    ]


def test_at_most_three_candidates_by_default():
    assert [c["speaker_id"] for c in _rank({"a": 0.1, "b": 0.2, "c": 0.3, "d": 0.4})] == ["d", "c", "b"]


def test_limit_can_be_changed():
    assert [c["speaker_id"] for c in _rank({"a": 0.1, "b": 0.2}, limit=1)] == ["b"]


def test_score_is_rounded_to_two_digits():
    assert _rank({"a": 0.6789})[0]["score"] == 0.68


def test_negative_similarity_becomes_zero():
    candidate = rank_candidates(VOICE, {"a": _vec(-1.0, 0.0, 0.0)}, {"a": "A"})[0]
    assert candidate["score"] == 0.0
    assert candidate["suggested"] is False


@pytest.mark.parametrize("cos, suggested", [(0.51, True), (0.5, True), (0.49, False)])
def test_suggested_from_the_threshold_up(cos, suggested):
    assert _rank({"a": cos})[0]["suggested"] is suggested


def test_threshold_is_compared_with_the_score_shown():
    # 0.496 is shown as 50%, the same as a speaker exactly on the threshold.
    assert _rank({"a": 0.496})[0] == {"speaker_id": "a", "name": "A", "score": 0.5, "suggested": True}


def test_threshold_can_be_changed():
    assert _rank({"a": 0.6}, threshold=0.7)[0]["suggested"] is False


def test_only_the_first_candidate_is_suggested():
    assert [c["suggested"] for c in _rank({"a": 0.9, "b": 0.8, "c": 0.7})] == [True, False, False]


def test_equal_scores_keep_a_stable_order():
    first = _rank({"b": 0.5, "a": 0.5})
    second = _rank({"a": 0.5, "b": 0.5})
    assert first == second
    assert [c["speaker_id"] for c in first] == ["a", "b"]


def test_no_profiles_give_no_candidates():
    assert rank_candidates(VOICE, {}, {}) == []


def test_the_inputs_are_not_changed():
    profiles = {"a": _vec(3.0, 4.0, 0.0)}
    names = {"a": "A"}
    voice = _vec(2.0, 0.0, 0.0)
    rank_candidates(voice, profiles, names)
    assert profiles["a"].tolist() == [3.0, 4.0, 0.0]
    assert names == {"a": "A"}
    assert voice.tolist() == [2.0, 0.0, 0.0]


def test_voice_centroid_is_the_normalised_mean():
    centroid = voice_centroid([_vec(2.0, 0.0), _vec(0.0, 2.0)])
    assert centroid == pytest.approx([math.sqrt(0.5), math.sqrt(0.5)])


def test_voice_centroid_of_nothing_is_none():
    assert voice_centroid([]) is None


def test_voice_centroid_of_opposite_embeddings_stays_zero():
    assert voice_centroid([_vec(1.0, 0.0), _vec(-1.0, 0.0)]).tolist() == [0.0, 0.0]
