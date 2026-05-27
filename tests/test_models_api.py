"""Tests for the /models API endpoints — GET /models, DELETE, POST /download."""
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

from app.api.main import app
from app.api.dependencies import get_memory_service, get_storage_service
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.speaker_memory_service import SpeakerMemoryService

CATALOG_IDS = {"tiny", "base", "small", "medium", "large-v3", "diarize"}


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def client(tmp_path):
    """TestClient with overridden DB dependencies; MODELS_DIR patched to tmp_path."""
    transcript_db = str(tmp_path / "transcripts.db")
    memory_db     = str(tmp_path / "memory.db")

    def _storage():
        return TranscriptStorageService(db_path=transcript_db)

    def _memory():
        return SpeakerMemoryService(db_path=memory_db)

    app.dependency_overrides[get_storage_service] = _storage
    app.dependency_overrides[get_memory_service]  = _memory

    # Patch all model dirs so ModelService uses tmp_path — no real model files on disk.
    import app.config as config
    original_whisper = config.WHISPER_MODELS_DIR
    original_hf = config.HF_MODELS_DIR
    original_alignment = config.ALIGNMENT_MODELS_DIR
    config.WHISPER_MODELS_DIR = tmp_path
    config.HF_MODELS_DIR = tmp_path / "hf"
    config.ALIGNMENT_MODELS_DIR = tmp_path / "alignment"

    yield TestClient(app)

    config.WHISPER_MODELS_DIR = original_whisper
    config.HF_MODELS_DIR = original_hf
    config.ALIGNMENT_MODELS_DIR = original_alignment
    app.dependency_overrides.clear()


def _make_installed_model(tmp_path: Path, model_id: str) -> Path:
    """Create the HuggingFace cache directory structure that ModelService checks."""
    # ModelService._cache_dir returns:
    #   models_dir / "models--Systran--faster-whisper-{id}"
    # is_installed() checks for  .../refs/main  existing.
    from app.services.model_service import WHISPER_CATALOG
    hf_repo = WHISPER_CATALOG[model_id]["hf_repo"]
    cache_dir = tmp_path / ("models--" + hf_repo.replace("/", "--"))
    refs_dir  = cache_dir / "refs"
    refs_dir.mkdir(parents=True, exist_ok=True)
    sentinel = refs_dir / "main"
    sentinel.write_text("abc123\n")
    return cache_dir


# ── GET /models ───────────────────────────────────────────────────────────────

def test_list_models_returns_200(client):
    """GET /models returns HTTP 200."""
    r = client.get("/models")
    assert r.status_code == 200


def test_list_models_returns_array(client):
    """GET /models returns a JSON array."""
    r = client.get("/models")
    assert isinstance(r.json(), list)


def test_list_models_has_at_least_six_entries(client):
    """GET /models returns at least 6 entries — 5 Whisper + 1 diarization + alignment models."""
    r = client.get("/models")
    assert len(r.json()) >= 6


def test_list_models_entries_have_id_and_installed_keys(client):
    """Each entry in the /models response has 'id' and 'installed' keys."""
    r = client.get("/models")
    for entry in r.json():
        assert "id" in entry, f"Missing 'id' key in entry: {entry}"
        assert "installed" in entry, f"Missing 'installed' key in entry: {entry}"


def test_list_models_installed_field_is_boolean(client):
    """The 'installed' field in each /models entry is a boolean."""
    r = client.get("/models")
    for entry in r.json():
        assert isinstance(entry["installed"], bool), (
            f"Expected bool for 'installed', got {type(entry['installed'])} in {entry}"
        )


def test_list_models_ids_match_catalog(client):
    """GET /models includes all Whisper + diarization catalog IDs (alignment models may also be present)."""
    r = client.get("/models")
    returned_ids = {entry["id"] for entry in r.json()}
    assert CATALOG_IDS.issubset(returned_ids), (
        f"Expected catalog IDs {CATALOG_IDS} to be a subset of {returned_ids}"
    )


def test_list_models_installed_false_when_no_files_on_disk(client):
    """All models report installed=False when no model files exist under MODELS_DIR."""
    r = client.get("/models")
    for entry in r.json():
        assert entry["installed"] is False, (
            f"Model {entry['id']!r} should not be installed on a clean tmp_path, "
            f"but got installed={entry['installed']}"
        )


def test_list_models_installed_true_when_cache_dir_exists(tmp_path):
    """A model reports installed=True when its HF cache dir exists on disk."""
    import app.config as config
    original_models_dir = config.WHISPER_MODELS_DIR
    original_hf_models_dir = config.HF_MODELS_DIR
    config.WHISPER_MODELS_DIR = tmp_path
    config.HF_MODELS_DIR = tmp_path / "hf"

    transcript_db = str(tmp_path / "transcripts.db")
    memory_db     = str(tmp_path / "memory.db")

    def _storage():
        return TranscriptStorageService(db_path=transcript_db)

    def _memory():
        return SpeakerMemoryService(db_path=memory_db)

    app.dependency_overrides[get_storage_service] = _storage
    app.dependency_overrides[get_memory_service]  = _memory

    try:
        _make_installed_model(tmp_path, "small")

        tc = TestClient(app)
        r = tc.get("/models")
        assert r.status_code == 200
        entries = {e["id"]: e["installed"] for e in r.json()}
        assert entries["small"] is True, (
            "small should be installed=True after creating its cache dir"
        )
        # All others should still be False
        for mid in CATALOG_IDS - {"small"}:
            assert entries[mid] is False, (
                f"{mid!r} should be installed=False, got {entries[mid]}"
            )
    finally:
        config.WHISPER_MODELS_DIR = original_models_dir
        config.HF_MODELS_DIR = original_hf_models_dir
        app.dependency_overrides.clear()


# ── DELETE /models/{model_id} ─────────────────────────────────────────────────

def test_delete_installed_model_returns_200(tmp_path):
    """DELETE /models/{model_id} returns 200 when the model is installed."""
    import app.config as config
    original_models_dir = config.WHISPER_MODELS_DIR
    original_hf_models_dir = config.HF_MODELS_DIR
    config.WHISPER_MODELS_DIR = tmp_path
    config.HF_MODELS_DIR = tmp_path / "hf"

    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(
        db_path=str(tmp_path / "transcripts.db")
    )
    app.dependency_overrides[get_memory_service] = lambda: SpeakerMemoryService(
        db_path=str(tmp_path / "memory.db")
    )

    try:
        _make_installed_model(tmp_path, "base")
        tc = TestClient(app)
        r = tc.delete("/models/base")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    finally:
        config.WHISPER_MODELS_DIR = original_models_dir
        config.HF_MODELS_DIR = original_hf_models_dir
        app.dependency_overrides.clear()


def test_delete_installed_model_removes_directory(tmp_path):
    """DELETE /models/{model_id} actually removes the cache directory from disk."""
    import app.config as config
    from app.services.model_service import WHISPER_CATALOG

    original_models_dir = config.WHISPER_MODELS_DIR
    original_hf_models_dir = config.HF_MODELS_DIR
    config.WHISPER_MODELS_DIR = tmp_path
    config.HF_MODELS_DIR = tmp_path / "hf"

    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(
        db_path=str(tmp_path / "transcripts.db")
    )
    app.dependency_overrides[get_memory_service] = lambda: SpeakerMemoryService(
        db_path=str(tmp_path / "memory.db")
    )

    try:
        cache_dir = _make_installed_model(tmp_path, "base")
        assert cache_dir.exists(), "Cache dir must exist before delete"

        tc = TestClient(app)
        tc.delete("/models/base")

        assert not cache_dir.exists(), (
            f"Cache directory should be removed after DELETE /models/base, "
            f"but {cache_dir} still exists"
        )
    finally:
        config.WHISPER_MODELS_DIR = original_models_dir
        config.HF_MODELS_DIR = original_hf_models_dir
        app.dependency_overrides.clear()


def test_delete_model_not_installed_returns_404(tmp_path):
    """DELETE /models/{model_id} returns 404 when the model is not installed.

    The route must exist (GET /models must return 200) before this test is
    meaningful — we explicitly verify the route is registered so a generic
    'route not found' 404 cannot mask the real assertion.
    """
    import app.config as config
    original_models_dir = config.WHISPER_MODELS_DIR
    original_hf_models_dir = config.HF_MODELS_DIR
    config.WHISPER_MODELS_DIR = tmp_path
    config.HF_MODELS_DIR = tmp_path / "hf"

    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(
        db_path=str(tmp_path / "transcripts.db")
    )
    app.dependency_overrides[get_memory_service] = lambda: SpeakerMemoryService(
        db_path=str(tmp_path / "memory.db")
    )

    try:
        tc = TestClient(app)
        # First confirm GET /models is registered (route exists).
        list_r = tc.get("/models")
        assert list_r.status_code == 200, (
            f"GET /models must return 200 (route must exist) before testing DELETE; "
            f"got {list_r.status_code}. If this fails, the router is not registered yet."
        )
        # Now verify DELETE returns 404 for an uninstalled model.
        r = tc.delete("/models/tiny")
        assert r.status_code == 404, (
            f"Expected 404 for uninstalled model, got {r.status_code}: {r.text}"
        )
    finally:
        config.WHISPER_MODELS_DIR = original_models_dir
        config.HF_MODELS_DIR = original_hf_models_dir
        app.dependency_overrides.clear()


def test_delete_unknown_model_returns_400(client):
    """DELETE /models/{model_id} returns 400 when model_id is not in the catalog."""
    r = client.delete("/models/nonexistent-model")
    assert r.status_code == 400, (
        f"Expected 400 for unknown model_id, got {r.status_code}: {r.text}"
    )


# ── POST /models/{model_id}/download ─────────────────────────────────────────

def test_download_model_returns_200(client):
    """POST /models/{model_id}/download returns HTTP 200."""
    r = client.post("/models/small/download")
    assert r.status_code == 200, (
        f"Expected 200 from download endpoint, got {r.status_code}: {r.text}"
    )


def test_download_model_returns_job_id(client):
    """POST /models/{model_id}/download response contains a 'job_id' field."""
    r = client.post("/models/small/download")
    assert r.status_code == 200
    body = r.json()
    assert "job_id" in body, (
        f"Expected 'job_id' in response, got keys: {list(body.keys())}"
    )


def test_download_model_job_id_is_nonempty_string(client):
    """POST /models/{model_id}/download returns a non-empty string job_id."""
    r = client.post("/models/small/download")
    assert r.status_code == 200
    job_id = r.json().get("job_id")
    assert isinstance(job_id, str), f"Expected str job_id, got {type(job_id)}"
    assert len(job_id) > 0, "job_id must be a non-empty string"


# ── Alignment model endpoints ─────────────────────────────────────────────────

def test_list_models_includes_alignment_entries(client):
    """GET /models response includes at least one alignment entry (e.g. 'ru')."""
    from app.services.model_service import ALIGNMENT_CATALOG
    r = client.get("/models")
    assert r.status_code == 200
    returned_ids = {e["id"] for e in r.json()}
    alignment_ids_in_response = returned_ids & set(ALIGNMENT_CATALOG.keys())
    assert len(alignment_ids_in_response) > 0, (
        f"Expected at least one alignment model id in GET /models, "
        f"got ids: {returned_ids}"
    )


def test_download_alignment_model_returns_200_with_job_id(client):
    """POST /models/ru/download returns 200 or 202 with a job_id field."""
    r = client.post("/models/ru/download")
    assert r.status_code in (200, 202), (
        f"Expected 200 or 202 for alignment model download, got {r.status_code}: {r.text}"
    )
    assert "job_id" in r.json(), (
        f"Expected 'job_id' in response body, got: {r.json()}"
    )


def test_download_alignment_model_job_id_is_nonempty_string(client):
    """POST /models/ru/download returns a non-empty string job_id."""
    r = client.post("/models/ru/download")
    assert r.status_code in (200, 202)
    job_id = r.json().get("job_id")
    assert isinstance(job_id, str) and len(job_id) > 0, (
        f"Expected a non-empty string job_id, got: {job_id!r}"
    )


def test_delete_alignment_model_installed_returns_200(tmp_path):
    """DELETE /models/ru returns 200 when the alignment model is installed."""
    import app.config as config
    from app.services.model_service import ALIGNMENT_CATALOG

    original_whisper = config.WHISPER_MODELS_DIR
    original_hf = config.HF_MODELS_DIR

    config.WHISPER_MODELS_DIR = tmp_path / "whisper"
    config.HF_MODELS_DIR = tmp_path / "hf"

    # Also patch ALIGNMENT_MODELS_DIR if it exists in config
    original_alignment = getattr(config, "ALIGNMENT_MODELS_DIR", None)
    alignment_dir = tmp_path / "alignment"
    config.ALIGNMENT_MODELS_DIR = alignment_dir

    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(
        db_path=str(tmp_path / "transcripts.db")
    )
    app.dependency_overrides[get_memory_service] = lambda: SpeakerMemoryService(
        db_path=str(tmp_path / "memory.db")
    )

    try:
        # Simulate installed ru alignment model
        hf_repo = ALIGNMENT_CATALOG["ru"]["hf_repo"]
        refs = alignment_dir / ("models--" + hf_repo.replace("/", "--")) / "refs"
        refs.mkdir(parents=True, exist_ok=True)
        (refs / "main").write_text("abc123")

        tc = TestClient(app)
        r = tc.delete("/models/ru")
        assert r.status_code == 200, (
            f"Expected 200 for DELETE /models/ru when installed, got {r.status_code}: {r.text}"
        )
    finally:
        config.WHISPER_MODELS_DIR = original_whisper
        config.HF_MODELS_DIR = original_hf
        if original_alignment is not None:
            config.ALIGNMENT_MODELS_DIR = original_alignment
        elif hasattr(config, "ALIGNMENT_MODELS_DIR"):
            del config.ALIGNMENT_MODELS_DIR
        app.dependency_overrides.clear()


def test_delete_unknown_model_id_returns_400(client):
    """DELETE /models/{model_id} returns 400 for a model_id completely unknown to the service."""
    r = client.delete("/models/totally_unknown_xyz")
    assert r.status_code == 400, (
        f"Expected 400 for unknown model_id (not in any catalog), "
        f"got {r.status_code}: {r.text}"
    )


def test_download_unknown_model_id_returns_400(client):
    """POST /models/{model_id}/download returns 400 for a model_id completely unknown to the service."""
    r = client.post("/models/totally_unknown_xyz/download")
    assert r.status_code == 400, (
        f"Expected 400 for unknown model_id (not in any catalog), "
        f"got {r.status_code}: {r.text}"
    )
