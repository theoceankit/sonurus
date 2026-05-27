"""Tests for diarization model management in ModelService and the /models API."""
import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.api.main import app
from app.api.dependencies import get_memory_service, get_storage_service
from app.services.model_service import ModelService, DIARIZATION_CATALOG
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.speaker_memory_service import SpeakerMemoryService


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

def make_service(tmp_path: Path) -> ModelService:
    whisper_dir = tmp_path / "whisper"
    hf_dir = tmp_path / "hf"
    return ModelService(whisper_dir, hf_dir)


def _install_diarize(hf_dir: Path) -> None:
    """Simulate a fully installed diarization model (both repos)."""
    for repo in DIARIZATION_CATALOG["diarize"]["hf_repos"]:
        refs = hf_dir / ("models--" + repo.replace("/", "--")) / "refs"
        refs.mkdir(parents=True, exist_ok=True)
        (refs / "main").write_text("abc123")


@pytest.fixture
def client(tmp_path):
    transcript_db = str(tmp_path / "transcripts.db")
    memory_db = str(tmp_path / "memory.db")

    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(db_path=transcript_db)
    app.dependency_overrides[get_memory_service] = lambda: SpeakerMemoryService(db_path=memory_db)

    import app.config as config
    original_whisper = config.WHISPER_MODELS_DIR
    original_hf = config.HF_MODELS_DIR
    config.WHISPER_MODELS_DIR = tmp_path / "whisper"
    config.HF_MODELS_DIR = tmp_path / "hf"

    yield TestClient(app)

    config.WHISPER_MODELS_DIR = original_whisper
    config.HF_MODELS_DIR = original_hf
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# DIARIZATION_CATALOG structure
# ---------------------------------------------------------------------------

def test_diarization_catalog_contains_diarize():
    assert "diarize" in DIARIZATION_CATALOG


def test_diarization_catalog_entry_has_hf_repos_and_size():
    entry = DIARIZATION_CATALOG["diarize"]
    assert "hf_repos" in entry
    assert isinstance(entry["hf_repos"], list)
    assert len(entry["hf_repos"]) >= 1
    assert "size_bytes" in entry
    assert entry["size_bytes"] > 0


def test_diarization_catalog_includes_speaker_diarization_repo():
    repos = DIARIZATION_CATALOG["diarize"]["hf_repos"]
    assert any("speaker-diarization" in r for r in repos), (
        "Expected pyannote/speaker-diarization-community-1 in hf_repos"
    )


def test_diarization_catalog_includes_community_one_repo():
    """DIARIZATION_CATALOG must use community-1 (whisperx default)."""
    repos = DIARIZATION_CATALOG["diarize"]["hf_repos"]
    assert "pyannote/speaker-diarization-community-1" in repos, (
        f"Expected 'pyannote/speaker-diarization-community-1' in hf_repos, got: {repos}"
    )


def test_diarization_catalog_has_exactly_two_repos():
    """DIARIZATION_CATALOG['diarize']['hf_repos'] must have exactly 2 entries."""
    repos = DIARIZATION_CATALOG["diarize"]["hf_repos"]
    assert len(repos) == 2, (
        f"Expected 2 repos in DIARIZATION_CATALOG['diarize']['hf_repos'], got {len(repos)}: {repos}"
    )


def test_diarization_catalog_includes_embedding_repo():
    """DIARIZATION_CATALOG must include pyannote/embedding for EmbeddingService."""
    repos = DIARIZATION_CATALOG["diarize"]["hf_repos"]
    assert "pyannote/embedding" in repos, (
        f"Expected 'pyannote/embedding' in hf_repos, got: {repos}"
    )


# ---------------------------------------------------------------------------
# ModelService.is_installed("diarize")
# ---------------------------------------------------------------------------

def test_is_installed_diarize_false_when_hf_dir_empty(tmp_path):
    svc = make_service(tmp_path)
    assert svc.is_installed("diarize") is False


def test_is_installed_diarize_false_when_only_one_repo_present(tmp_path):
    """Returns False when only 1 of the 2 required repos is installed."""
    hf_dir = tmp_path / "hf"
    first_repo = DIARIZATION_CATALOG["diarize"]["hf_repos"][0]
    refs = hf_dir / ("models--" + first_repo.replace("/", "--")) / "refs"
    refs.mkdir(parents=True)
    (refs / "main").write_text("abc123")

    svc = make_service(tmp_path)
    assert svc.is_installed("diarize") is False


def test_is_installed_diarize_true_when_all_repos_present(tmp_path):
    """Returns True when all required repos have refs/main."""
    hf_dir = tmp_path / "hf"
    _install_diarize(hf_dir)
    svc = make_service(tmp_path)
    assert svc.is_installed("diarize") is True


def test_is_installed_diarize_false_when_refs_main_missing(tmp_path):
    hf_dir = tmp_path / "hf"
    for repo in DIARIZATION_CATALOG["diarize"]["hf_repos"]:
        cache = hf_dir / ("models--" + repo.replace("/", "--"))
        cache.mkdir(parents=True)

    svc = make_service(tmp_path)
    assert svc.is_installed("diarize") is False


# ---------------------------------------------------------------------------
# ModelService.list_models() includes diarize
# ---------------------------------------------------------------------------

def test_list_models_includes_diarize_entry(tmp_path):
    svc = make_service(tmp_path)
    ids = {e["id"] for e in svc.list_models()}
    assert "diarize" in ids


def test_list_models_diarize_installed_false_when_not_on_disk(tmp_path):
    svc = make_service(tmp_path)
    entry = next(e for e in svc.list_models() if e["id"] == "diarize")
    assert entry["installed"] is False


def test_list_models_diarize_installed_true_when_on_disk(tmp_path):
    hf_dir = tmp_path / "hf"
    _install_diarize(hf_dir)
    svc = make_service(tmp_path)
    entry = next(e for e in svc.list_models() if e["id"] == "diarize")
    assert entry["installed"] is True


# ---------------------------------------------------------------------------
# ModelService.download_model("diarize")
# ---------------------------------------------------------------------------

def test_download_diarize_calls_snapshot_for_both_repos(tmp_path):
    svc = make_service(tmp_path)
    downloaded = []

    def fake_download(repo, **kwargs):
        downloaded.append(repo)

    with patch("app.services.model_service.huggingface_hub.snapshot_download", side_effect=fake_download):
        svc.download_model("diarize")

    expected = DIARIZATION_CATALOG["diarize"]["hf_repos"]
    assert downloaded == expected, f"Expected {expected}, got {downloaded}"


def test_download_diarize_passes_hf_models_dir_as_cache(tmp_path):
    hf_dir = tmp_path / "hf"
    svc = make_service(tmp_path)
    captured_cache_dirs = []

    def fake_download(repo, cache_dir=None, **kwargs):
        captured_cache_dirs.append(cache_dir)

    with patch("app.services.model_service.huggingface_hub.snapshot_download", side_effect=fake_download):
        svc.download_model("diarize")

    for cache_dir in captured_cache_dirs:
        assert cache_dir == str(hf_dir), (
            f"Expected cache_dir={str(hf_dir)!r}, got {cache_dir!r}"
        )


def test_download_diarize_respects_cancel_event_before_first_repo(tmp_path):
    from asyncio import CancelledError
    svc = make_service(tmp_path)
    cancel = threading.Event()
    cancel.set()

    with patch("app.services.model_service.huggingface_hub.snapshot_download") as mock_dl:
        with pytest.raises(CancelledError):
            svc.download_model("diarize", cancel_event=cancel)
        mock_dl.assert_not_called()


def test_download_diarize_respects_cancel_event_between_repos(tmp_path):
    from asyncio import CancelledError
    svc = make_service(tmp_path)
    cancel = threading.Event()
    call_count = [0]

    def fake_download(repo, **kwargs):
        call_count[0] += 1
        cancel.set()

    with patch("app.services.model_service.huggingface_hub.snapshot_download", side_effect=fake_download):
        with pytest.raises(CancelledError):
            svc.download_model("diarize", cancel_event=cancel)

    assert call_count[0] == 1, "Should have aborted after the first repo when cancel is set"


# ---------------------------------------------------------------------------
# ModelService.delete_model("diarize")
# ---------------------------------------------------------------------------

def test_delete_diarize_removes_both_cache_dirs(tmp_path):
    hf_dir = tmp_path / "hf"
    _install_diarize(hf_dir)

    svc = make_service(tmp_path)
    assert svc.is_installed("diarize") is True

    svc.delete_model("diarize")
    assert svc.is_installed("diarize") is False

    for repo in DIARIZATION_CATALOG["diarize"]["hf_repos"]:
        cache = hf_dir / ("models--" + repo.replace("/", "--"))
        assert not cache.exists(), f"{cache} should be removed after delete"


def test_delete_diarize_raises_file_not_found_when_not_installed(tmp_path):
    svc = make_service(tmp_path)
    with pytest.raises(FileNotFoundError):
        svc.delete_model("diarize")


# ---------------------------------------------------------------------------
# GET /models — includes diarize
# ---------------------------------------------------------------------------

def test_api_list_models_includes_diarize(client):
    r = client.get("/models")
    assert r.status_code == 200
    ids = {e["id"] for e in r.json()}
    assert "diarize" in ids


def test_api_list_models_diarize_installed_false_on_clean_dir(client):
    r = client.get("/models")
    entries = {e["id"]: e["installed"] for e in r.json()}
    assert entries["diarize"] is False


# ---------------------------------------------------------------------------
# POST /models/diarize/download
# ---------------------------------------------------------------------------

def test_api_download_diarize_returns_200(client):
    r = client.post("/models/diarize/download")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"


def test_api_download_diarize_returns_job_id(client):
    r = client.post("/models/diarize/download")
    assert r.status_code == 200
    assert "job_id" in r.json()


# ---------------------------------------------------------------------------
# DELETE /models/diarize
# ---------------------------------------------------------------------------

def test_api_delete_diarize_installed_returns_200(client, tmp_path):
    import app.config as config
    _install_diarize(config.HF_MODELS_DIR)

    r = client.delete("/models/diarize")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    assert r.json() == {"deleted": "diarize"}


def test_api_delete_diarize_not_installed_returns_404(client):
    r = client.delete("/models/diarize")
    assert r.status_code == 404
