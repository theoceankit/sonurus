"""Tests for the model-installation guard on POST /transcribe."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.main import app
from app.api.dependencies import get_memory_service, get_storage_service
from app.services.model_service import DIARIZATION_CATALOG, WHISPER_CATALOG
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.speaker_memory_service import SpeakerMemoryService


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def client(tmp_path):
    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(
        db_path=str(tmp_path / "transcripts.db")
    )
    app.dependency_overrides[get_memory_service] = lambda: SpeakerMemoryService(
        db_path=str(tmp_path / "memory.db")
    )

    import app.config as config
    original_whisper = config.WHISPER_MODELS_DIR
    original_hf = config.HF_MODELS_DIR
    config.WHISPER_MODELS_DIR = tmp_path / "whisper"
    config.HF_MODELS_DIR = tmp_path / "hf"

    yield TestClient(app), tmp_path

    config.WHISPER_MODELS_DIR = original_whisper
    config.HF_MODELS_DIR = original_hf
    app.dependency_overrides.clear()


def _install_whisper(whisper_dir: Path, model_id: str) -> None:
    hf_repo = WHISPER_CATALOG[model_id]["hf_repo"]
    refs = whisper_dir / ("models--" + hf_repo.replace("/", "--")) / "refs"
    refs.mkdir(parents=True, exist_ok=True)
    (refs / "main").write_text("abc123")


def _install_diarize(hf_dir: Path) -> None:
    for repo in DIARIZATION_CATALOG["diarize"]["hf_repos"]:
        refs = hf_dir / ("models--" + repo.replace("/", "--")) / "refs"
        refs.mkdir(parents=True, exist_ok=True)
        (refs / "main").write_text("abc123")


# ---------------------------------------------------------------------------
# Guard: Whisper model not installed
# ---------------------------------------------------------------------------

def test_transcribe_returns_400_when_whisper_not_installed(client):
    tc, tmp_path = client
    r = tc.post("/transcribe", json={"audio_path": "/fake/audio.wav", "whisper_model": "small"})
    assert r.status_code == 400, f"Expected 400 when whisper model not installed, got {r.status_code}: {r.text}"
    assert "small" in r.json()["detail"]


def test_transcribe_returns_400_with_default_model_when_not_installed(client):
    """Uses default WHISPER_MODEL when whisper_model is omitted — guard must still fire."""
    import app.config as config
    tc, tmp_path = client
    r = tc.post("/transcribe", json={"audio_path": "/fake/audio.wav"})
    assert r.status_code == 400, (
        f"Expected 400 when default whisper model not installed, got {r.status_code}: {r.text}"
    )


def test_transcribe_400_detail_mentions_settings(client):
    """The 400 error message must mention Settings so the user knows where to fix it."""
    tc, tmp_path = client
    r = tc.post("/transcribe", json={"audio_path": "/fake/audio.wav", "whisper_model": "tiny"})
    assert r.status_code == 400
    assert "Settings" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Guard: Diarization model not installed
# ---------------------------------------------------------------------------

def test_transcribe_returns_400_when_diarize_not_installed(client):
    """Whisper is installed but diarization is not — must return 400."""
    tc, tmp_path = client
    _install_whisper(tmp_path / "whisper", "tiny")

    r = tc.post("/transcribe", json={"audio_path": "/fake/audio.wav", "whisper_model": "tiny"})
    assert r.status_code == 400, (
        f"Expected 400 when diarization model not installed, got {r.status_code}: {r.text}"
    )
    assert "Diarization" in r.json()["detail"] or "diarization" in r.json()["detail"].lower()


def test_transcribe_diarize_400_detail_mentions_settings(client):
    tc, tmp_path = client
    _install_whisper(tmp_path / "whisper", "tiny")

    r = tc.post("/transcribe", json={"audio_path": "/fake/audio.wav", "whisper_model": "tiny"})
    assert r.status_code == 400
    assert "Settings" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Guard: Both models installed — guard passes (pipeline not actually run)
# ---------------------------------------------------------------------------

def test_transcribe_guard_passes_when_both_models_installed(client):
    """When both models are installed the guard passes and the pipeline starts
    (job_id is returned). We do NOT actually run the pipeline — snapshot_download
    is never called here — so we just verify the HTTP response is 200."""
    from unittest.mock import patch, MagicMock

    tc, tmp_path = client
    _install_whisper(tmp_path / "whisper", "small")
    _install_diarize(tmp_path / "hf")

    # Patch create_controller so no actual ML code runs.
    mock_controller = MagicMock()
    mock_controller.memory_service = MagicMock()
    mock_transcript = MagicMock()
    mock_transcript.db_id = "test-transcript-id"
    mock_controller.run_pipeline.return_value = mock_transcript

    mock_storage = MagicMock()

    with patch("app.api.routers.transcription.create_controller", return_value=(mock_controller, mock_storage)):
        r = tc.post("/transcribe", json={"audio_path": "/fake/audio.wav", "whisper_model": "small"})

    assert r.status_code == 200, (
        f"Expected 200 when both models are installed, got {r.status_code}: {r.text}"
    )
    assert "job_id" in r.json()
