"""Tests for the model-installation guard on POST /transcribe."""
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.api.main import app
from app.api.dependencies import get_memory_service, get_storage_service
from app.services.model_service import DIARIZATION_CATALOG, WHISPER_CATALOG
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.speaker_memory_service import SpeakerMemoryService


@pytest.fixture(autouse=True)
def _patch_archive_service():
    """Prevent ArchiveService from running with mock transcript objects.

    MagicMock().__index__() returns 1 (stdout FD). shutil.copy2(MagicMock, ...)
    opens and closes FD 1 as a side effect, corrupting pytest's terminal writer.
    """
    with patch("app.api.routers.transcription.ArchiveService"):
        yield


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
    original_alignment = getattr(config, "ALIGNMENT_MODELS_DIR", None)
    config.WHISPER_MODELS_DIR = tmp_path / "whisper"
    config.HF_MODELS_DIR = tmp_path / "hf"
    config.ALIGNMENT_MODELS_DIR = tmp_path / "alignment"

    yield TestClient(app), tmp_path

    config.WHISPER_MODELS_DIR = original_whisper
    config.HF_MODELS_DIR = original_hf
    if original_alignment is not None:
        config.ALIGNMENT_MODELS_DIR = original_alignment
    else:
        # Remove the attribute we added, only if we added it (it didn't exist before)
        try:
            delattr(config, "ALIGNMENT_MODELS_DIR")
        except AttributeError:
            pass
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


# ---------------------------------------------------------------------------
# Guard: Alignment model not installed
# ---------------------------------------------------------------------------

def _install_whisper_and_diarize(tmp_path: Path, whisper_model: str = "small") -> None:
    """Install both whisper and diarize so only the alignment guard can fire."""
    _install_whisper(tmp_path / "whisper", whisper_model)
    _install_diarize(tmp_path / "hf")


def _install_alignment(alignment_dir: Path, lang_code: str) -> None:
    """Simulate a fully installed alignment model by creating refs/main."""
    from app.services.model_service import ALIGNMENT_CATALOG
    hf_repo = ALIGNMENT_CATALOG[lang_code]["hf_repo"]
    refs = alignment_dir / ("models--" + hf_repo.replace("/", "--")) / "refs"
    refs.mkdir(parents=True, exist_ok=True)
    (refs / "main").write_text("abc123")


def test_transcribe_returns_400_when_alignment_model_not_installed(client):
    """POST /transcribe with language='ru' and alignment not installed → HTTP 400."""
    tc, tmp_path = client
    _install_whisper_and_diarize(tmp_path, "small")
    # Do NOT install alignment model for 'ru'

    r = tc.post(
        "/transcribe",
        json={"audio_path": "/fake/audio.wav", "whisper_model": "small", "language": "ru"},
    )
    assert r.status_code == 400, (
        f"Expected 400 when alignment model for 'ru' is not installed, "
        f"got {r.status_code}: {r.text}"
    )


def test_transcribe_400_alignment_detail_mentions_alignment(client):
    """The 400 error detail must contain the word 'alignment' (case-insensitive)."""
    tc, tmp_path = client
    _install_whisper_and_diarize(tmp_path, "small")

    r = tc.post(
        "/transcribe",
        json={"audio_path": "/fake/audio.wav", "whisper_model": "small", "language": "ru"},
    )
    assert r.status_code == 400
    detail = r.json()["detail"].lower()
    assert "alignment" in detail, (
        f"Expected 'alignment' in error detail, got: {r.json()['detail']!r}"
    )


def test_transcribe_400_alignment_detail_mentions_language_code(client):
    """The 400 error detail must mention the language code (e.g. 'ru')."""
    tc, tmp_path = client
    _install_whisper_and_diarize(tmp_path, "small")

    r = tc.post(
        "/transcribe",
        json={"audio_path": "/fake/audio.wav", "whisper_model": "small", "language": "ru"},
    )
    assert r.status_code == 400
    assert "ru" in r.json()["detail"], (
        f"Expected language code 'ru' in error detail, got: {r.json()['detail']!r}"
    )


def test_transcribe_not_blocked_when_language_is_none(client):
    """POST /transcribe with language=None (auto-detect) is NOT blocked by the alignment guard."""
    from unittest.mock import patch, MagicMock

    tc, tmp_path = client
    _install_whisper_and_diarize(tmp_path, "small")
    # No alignment model installed — but language is None so guard must not fire

    mock_controller = MagicMock()
    mock_controller.memory_service = MagicMock()
    mock_transcript = MagicMock()
    mock_transcript.db_id = "test-id"
    mock_controller.run_pipeline.return_value = mock_transcript

    with patch("app.api.routers.transcription.create_controller", return_value=(mock_controller, MagicMock())):
        r = tc.post(
            "/transcribe",
            json={"audio_path": "/fake/audio.wav", "whisper_model": "small"},
            # language key deliberately omitted → None
        )

    assert r.status_code == 200, (
        f"Expected guard to pass when language is None, "
        f"got {r.status_code}: {r.text}"
    )


def test_transcribe_not_blocked_when_language_is_auto(client):
    """POST /transcribe with language='auto' is NOT blocked by the alignment guard."""
    from unittest.mock import patch, MagicMock

    tc, tmp_path = client
    _install_whisper_and_diarize(tmp_path, "small")

    mock_controller = MagicMock()
    mock_controller.memory_service = MagicMock()
    mock_transcript = MagicMock()
    mock_transcript.db_id = "test-id"
    mock_controller.run_pipeline.return_value = mock_transcript

    with patch("app.api.routers.transcription.create_controller", return_value=(mock_controller, MagicMock())):
        r = tc.post(
            "/transcribe",
            json={"audio_path": "/fake/audio.wav", "whisper_model": "small", "language": "auto"},
        )

    assert r.status_code == 200, (
        f"Expected guard to pass when language='auto', "
        f"got {r.status_code}: {r.text}"
    )


def test_transcribe_not_blocked_for_language_not_in_alignment_catalog(client):
    """POST /transcribe with language='en' (not in ALIGNMENT_CATALOG) is NOT blocked."""
    from unittest.mock import patch, MagicMock
    from app.services.model_service import ALIGNMENT_CATALOG

    tc, tmp_path = client
    _install_whisper_and_diarize(tmp_path, "small")
    # 'en' should not be in ALIGNMENT_CATALOG
    assert "en" not in ALIGNMENT_CATALOG, (
        "This test assumes 'en' is not in ALIGNMENT_CATALOG; "
        "if it was added, choose a different language for this test"
    )

    mock_controller = MagicMock()
    mock_controller.memory_service = MagicMock()
    mock_transcript = MagicMock()
    mock_transcript.db_id = "test-id"
    mock_controller.run_pipeline.return_value = mock_transcript

    with patch("app.api.routers.transcription.create_controller", return_value=(mock_controller, MagicMock())):
        r = tc.post(
            "/transcribe",
            json={"audio_path": "/fake/audio.wav", "whisper_model": "small", "language": "en"},
        )

    assert r.status_code == 200, (
        f"Expected guard to pass for language='en' (not in ALIGNMENT_CATALOG), "
        f"got {r.status_code}: {r.text}"
    )


def test_transcribe_not_blocked_for_fr_not_in_alignment_catalog(client):
    """POST /transcribe with language='fr' (not in ALIGNMENT_CATALOG) is NOT blocked."""
    from unittest.mock import patch, MagicMock
    from app.services.model_service import ALIGNMENT_CATALOG

    tc, tmp_path = client
    _install_whisper_and_diarize(tmp_path, "small")
    assert "fr" not in ALIGNMENT_CATALOG, (
        "This test assumes 'fr' is not in ALIGNMENT_CATALOG"
    )

    mock_controller = MagicMock()
    mock_controller.memory_service = MagicMock()
    mock_transcript = MagicMock()
    mock_transcript.db_id = "test-id"
    mock_controller.run_pipeline.return_value = mock_transcript

    with patch("app.api.routers.transcription.create_controller", return_value=(mock_controller, MagicMock())):
        r = tc.post(
            "/transcribe",
            json={"audio_path": "/fake/audio.wav", "whisper_model": "small", "language": "fr"},
        )

    assert r.status_code == 200, (
        f"Expected guard to pass for language='fr' (not in ALIGNMENT_CATALOG), "
        f"got {r.status_code}: {r.text}"
    )


# ---------------------------------------------------------------------------
# AlignmentModelMissingError — unit tests for TranscriptionService
# ---------------------------------------------------------------------------

def test_transcription_service_raises_alignment_error_when_model_missing(tmp_path):
    """TranscriptionService.transcribe() raises AlignmentModelMissingError when
    the auto-detected language is in ALIGNMENT_CATALOG and refs/main is absent."""
    from unittest.mock import patch, MagicMock
    from app.services.transcription_service import TranscriptionService, AlignmentModelMissingError
    from app.services.model_service import ALIGNMENT_CATALOG

    test_lang = next(iter(ALIGNMENT_CATALOG))  # first language in catalog

    with patch("app.services.transcription_service.whisperx") as mock_wx:
        mock_model = MagicMock()
        mock_wx.load_model.return_value = mock_model
        mock_wx.load_audio.return_value = MagicMock()
        mock_model.transcribe.return_value = {"language": test_lang, "segments": []}

        svc = TranscriptionService(device="cpu", models_dir=tmp_path)
        with pytest.raises(AlignmentModelMissingError) as exc_info:
            svc.transcribe("/fake/audio.wav", language=None)

    assert exc_info.value.language == test_lang


def test_transcription_service_no_error_when_alignment_model_installed(tmp_path):
    """No AlignmentModelMissingError when refs/main exists for the detected language."""
    from unittest.mock import patch, MagicMock
    from app.services.transcription_service import TranscriptionService, AlignmentModelMissingError
    from app.services.model_service import ALIGNMENT_CATALOG

    test_lang = next(iter(ALIGNMENT_CATALOG))
    hf_repo = ALIGNMENT_CATALOG[test_lang]["hf_repo"].replace("/", "--")
    refs = tmp_path / "alignment" / f"models--{hf_repo}" / "refs"
    refs.mkdir(parents=True)
    (refs / "main").write_text("abc123")

    with patch("app.services.transcription_service.whisperx") as mock_wx:
        mock_model = MagicMock()
        mock_wx.load_model.return_value = mock_model
        mock_wx.load_audio.return_value = MagicMock()
        mock_model.transcribe.return_value = {"language": test_lang, "segments": []}
        mock_wx.load_align_model.return_value = (MagicMock(), MagicMock())
        mock_wx.align.return_value = {"segments": []}
        mock_wx.diarize.DiarizationPipeline.return_value = MagicMock()
        mock_wx.assign_word_speakers.return_value = {"segments": []}

        svc = TranscriptionService(device="cpu", models_dir=tmp_path)
        try:
            svc.transcribe("/fake/audio.wav", language=None)
        except AlignmentModelMissingError:
            pytest.fail("AlignmentModelMissingError raised despite alignment model being installed")
        except Exception:
            pass  # Other errors from the mocked pipeline are expected


def test_transcription_service_no_error_for_language_not_in_catalog(tmp_path):
    """No AlignmentModelMissingError for languages not in ALIGNMENT_CATALOG (e.g. English)."""
    from unittest.mock import patch, MagicMock
    from app.services.transcription_service import TranscriptionService, AlignmentModelMissingError
    from app.services.model_service import ALIGNMENT_CATALOG

    assert "en" not in ALIGNMENT_CATALOG, "'en' must not be in ALIGNMENT_CATALOG for this test"

    with patch("app.services.transcription_service.whisperx") as mock_wx:
        mock_model = MagicMock()
        mock_wx.load_model.return_value = mock_model
        mock_wx.load_audio.return_value = MagicMock()
        mock_model.transcribe.return_value = {"language": "en", "segments": []}
        mock_wx.load_align_model.return_value = (MagicMock(), MagicMock())
        mock_wx.align.return_value = {"segments": []}
        mock_wx.diarize.DiarizationPipeline.return_value = MagicMock()
        mock_wx.assign_word_speakers.return_value = {"segments": []}

        svc = TranscriptionService(device="cpu", models_dir=tmp_path)
        try:
            svc.transcribe("/fake/audio.wav", language=None)
        except AlignmentModelMissingError:
            pytest.fail("AlignmentModelMissingError raised for English (not in ALIGNMENT_CATALOG)")
        except Exception:
            pass  # Other errors from the mocked pipeline are expected


def test_alignment_model_missing_error_carries_language(tmp_path):
    """AlignmentModelMissingError.language attribute equals the detected language code."""
    from unittest.mock import patch, MagicMock
    from app.services.transcription_service import TranscriptionService, AlignmentModelMissingError
    from app.services.model_service import ALIGNMENT_CATALOG

    test_lang = "ru"
    assert test_lang in ALIGNMENT_CATALOG

    with patch("app.services.transcription_service.whisperx") as mock_wx:
        mock_model = MagicMock()
        mock_wx.load_model.return_value = mock_model
        mock_wx.load_audio.return_value = MagicMock()
        mock_model.transcribe.return_value = {"language": test_lang, "segments": []}

        svc = TranscriptionService(device="cpu", models_dir=tmp_path)
        with pytest.raises(AlignmentModelMissingError) as exc_info:
            svc.transcribe("/fake/audio.wav")

    assert exc_info.value.language == "ru"


def test_transcribe_guard_passes_when_alignment_model_installed(client):
    """When whisper, diarize, and alignment model are all installed, guard passes."""
    from unittest.mock import patch, MagicMock

    tc, tmp_path = client
    _install_whisper_and_diarize(tmp_path, "small")
    _install_alignment(tmp_path / "alignment", "ru")

    mock_controller = MagicMock()
    mock_controller.memory_service = MagicMock()
    mock_transcript = MagicMock()
    mock_transcript.db_id = "test-id"
    mock_controller.run_pipeline.return_value = mock_transcript

    with patch("app.api.routers.transcription.create_controller", return_value=(mock_controller, MagicMock())):
        r = tc.post(
            "/transcribe",
            json={"audio_path": "/fake/audio.wav", "whisper_model": "small", "language": "ru"},
        )

    assert r.status_code == 200, (
        f"Expected 200 when all required models are installed, "
        f"got {r.status_code}: {r.text}"
    )
    assert "job_id" in r.json()
