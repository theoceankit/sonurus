"""Tests for EmbeddingService — verifies that extract_all() performs a single pyannote pass."""

import numpy as np
import pandas as pd
import pytest
from unittest.mock import patch


def make_service():
    """Constructs EmbeddingService without loading the pyannote model."""
    from app.services.embedding_service import EmbeddingService

    with patch.object(EmbeddingService, "__init__", lambda self, *a, **kw: None):
        svc = EmbeddingService.__new__(EmbeddingService)

    svc.sample_rate = 16000
    svc.min_duration = 1.0
    return svc


def make_diarization(*rows):
    """Builds a diarization DataFrame."""
    return pd.DataFrame(rows, columns=["start", "end", "speaker"])


def fake_embedding(start, end, _speaker=None):
    """Deterministic embedding derived from segment timestamps."""
    return np.array([start, end, 0.0])


def test_extract_all_calls_inference_once_per_segment():
    """extract_all() must call _get_embedding() exactly once per segment, not twice."""
    svc = make_service()
    call_count = {"n": 0}

    def counting_get_embedding(audio, start, end):
        call_count["n"] += 1
        return fake_embedding(start, end)

    svc._get_embedding = counting_get_embedding

    audio = np.zeros(16000 * 6)
    diarization = make_diarization(
        (0.0, 2.0, "SPEAKER_00"),
        (2.0, 4.0, "SPEAKER_01"),
        (4.0, 6.0, "SPEAKER_00"),
    )

    svc.extract_all(audio, diarization)

    assert call_count["n"] == 3, (
        f"Expected 3 _get_embedding calls (one per segment), got {call_count['n']}"
    )


def test_extract_all_aggregated_is_mean_of_segments():
    """Aggregated dict from extract_all() must be the mean of per-segment embeddings."""
    from collections import defaultdict
    svc = make_service()
    svc._get_embedding = lambda audio, start, end: fake_embedding(start, end)

    audio = np.zeros(16000 * 6)
    diarization = make_diarization(
        (0.0, 2.0, "SPEAKER_00"),
        (2.0, 4.0, "SPEAKER_01"),
        (4.0, 6.0, "SPEAKER_00"),
    )

    aggregated, segments = svc.extract_all(audio, diarization)

    speaker_embs = defaultdict(list)
    for s in segments:
        speaker_embs[s["speaker"]].append(s["embedding"])
    expected = {spk: np.mean(embs, axis=0) for spk, embs in speaker_embs.items()}

    assert set(aggregated.keys()) == set(expected.keys())
    for spk in expected:
        assert np.allclose(aggregated[spk], expected[spk])


def test_extract_all_segments_match_extract_segments():
    """Per-segment list from extract_all() must match extract_segments()."""
    svc = make_service()
    svc._get_embedding = lambda audio, start, end: fake_embedding(start, end)

    audio = np.zeros(16000 * 6)
    diarization = make_diarization(
        (0.0, 2.0, "SPEAKER_00"),
        (2.0, 4.0, "SPEAKER_01"),
    )

    _, segments_all = svc.extract_all(audio, diarization)
    segments_direct = svc.extract_segments(audio, diarization)

    assert len(segments_all) == len(segments_direct)
    for a, b in zip(segments_all, segments_direct):
        assert a["start"] == b["start"]
        assert a["end"] == b["end"]
        assert a["speaker"] == b["speaker"]
        assert np.allclose(a["embedding"], b["embedding"])
