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


def test_extract_all_aggregated_is_the_duration_weighted_voice_of_the_turns():
    """A speaker's voice from extract_all() is the mean of their turns' embeddings
    scaled to length 1, weighted by each turn's duration (voice_vector)."""
    svc = make_service()
    embeddings = {0.0: np.array([4.0, 0.0, 0.0]), 2.0: np.array([0.0, 1.0, 0.0]),
                  4.0: np.array([0.0, 0.0, 2.0])}
    svc._get_embedding = lambda audio, start, end: embeddings[start]

    audio = np.zeros(16000 * 10)
    diarization = make_diarization(
        (0.0, 2.0, "SPEAKER_00"),
        (2.0, 4.0, "SPEAKER_01"),
        (4.0, 10.0, "SPEAKER_00"),
    )

    aggregated, segments = svc.extract_all(audio, diarization)

    s00 = np.array([2.0, 0.0, 6.0])  # 2 s of x, 6 s of z
    expected = {"SPEAKER_00": s00 / np.linalg.norm(s00), "SPEAKER_01": np.array([0.0, 1.0, 0.0])}

    assert set(aggregated.keys()) == set(expected.keys())
    for spk in expected:
        assert np.allclose(aggregated[spk], expected[spk])


def test_extract_all_segments_match_extract_segments():
    """Per-segment list from extract_all() must match _extract_segments()."""
    svc = make_service()
    svc._get_embedding = lambda audio, start, end: fake_embedding(start, end)

    audio = np.zeros(16000 * 6)
    diarization = make_diarization(
        (0.0, 2.0, "SPEAKER_00"),
        (2.0, 4.0, "SPEAKER_01"),
    )

    _, segments_all = svc.extract_all(audio, diarization)
    segments_direct = svc._extract_segments(audio, diarization)

    assert len(segments_all) == len(segments_direct)
    for a, b in zip(segments_all, segments_direct):
        assert a["start"] == b["start"]
        assert a["end"] == b["end"]
        assert a["speaker"] == b["speaker"]
        assert np.allclose(a["embedding"], b["embedding"])


def test_model_is_wespeaker_from_the_community_one_snapshot(tmp_path):
    """Speaker memory uses the WeSpeaker ResNet34-LM in the embedding subfolder
    of the diarization repo, read from the app's own model cache."""
    from app.services import embedding_service

    with patch.object(embedding_service, "Model") as model, \
            patch.object(embedding_service, "Inference"):
        embedding_service.EmbeddingService("cpu", models_dir=tmp_path)

    model.from_pretrained.assert_called_once_with(
        "pyannote/speaker-diarization-community-1",
        subfolder="embedding",
        cache_dir=str(tmp_path / "hf"),
    )


def test_model_load_failure_is_a_runtime_error(tmp_path):
    from app.services import embedding_service

    with patch.object(embedding_service, "Model") as model, \
            patch.object(embedding_service, "Inference"):
        model.from_pretrained.side_effect = OSError("not in cache")
        with pytest.raises(RuntimeError, match="embedding model"):
            embedding_service.EmbeddingService("cpu", models_dir=tmp_path)
