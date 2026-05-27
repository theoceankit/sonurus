"""Tests for ModelService — verifies catalog lookup, install detection, listing, and deletion."""

import pytest
from pathlib import Path

from app.services.model_service import ModelService, WHISPER_CATALOG


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_service(tmp_path: Path) -> ModelService:
    """Return a ModelService pointed at a temporary whisper models directory."""
    models_dir = tmp_path / "whisper"
    return ModelService(models_dir)


def cache_dir_name(hf_repo: str) -> str:
    """Compute the HuggingFace cache directory name for a given repo string."""
    return "models--" + hf_repo.replace("/", "--")


def install_model(models_dir: Path, model_id: str) -> Path:
    """
    Simulate a completed model download by creating the cache directory
    with a refs/main file inside it.
    """
    repo = WHISPER_CATALOG[model_id]["hf_repo"]
    cache = models_dir / cache_dir_name(repo)
    refs = cache / "refs"
    refs.mkdir(parents=True, exist_ok=True)
    (refs / "main").write_text("abc123")
    return cache


def install_model_incomplete(models_dir: Path, model_id: str) -> Path:
    """
    Simulate an incomplete/interrupted download — cache dir exists but
    refs/main is absent.
    """
    repo = WHISPER_CATALOG[model_id]["hf_repo"]
    cache = models_dir / cache_dir_name(repo)
    cache.mkdir(parents=True, exist_ok=True)
    return cache


# ---------------------------------------------------------------------------
# WHISPER_CATALOG
# ---------------------------------------------------------------------------

def test_catalog_contains_all_five_models():
    """WHISPER_CATALOG must have exactly the five documented model IDs."""
    expected = {"tiny", "base", "small", "medium", "large-v3"}
    assert set(WHISPER_CATALOG.keys()) == expected


def test_catalog_entries_have_hf_repo_and_size():
    """Every catalog entry must contain hf_repo (str) and size_bytes (int)."""
    for model_id, entry in WHISPER_CATALOG.items():
        assert "hf_repo" in entry, f"{model_id} missing hf_repo"
        assert "size_bytes" in entry, f"{model_id} missing size_bytes"
        assert isinstance(entry["hf_repo"], str), f"{model_id}.hf_repo must be str"
        assert isinstance(entry["size_bytes"], int), f"{model_id}.size_bytes must be int"


def test_catalog_large_v3_repo():
    """large-v3 must map to Systran/faster-whisper-large-v3."""
    assert WHISPER_CATALOG["large-v3"]["hf_repo"] == "Systran/faster-whisper-large-v3"


def test_catalog_size_bytes_are_positive():
    """All size_bytes values must be positive integers."""
    for model_id, entry in WHISPER_CATALOG.items():
        assert entry["size_bytes"] > 0, f"{model_id}.size_bytes must be positive"


# ---------------------------------------------------------------------------
# ModelService construction
# ---------------------------------------------------------------------------

def test_constructor_accepts_path(tmp_path):
    """ModelService can be constructed with a Path argument without raising."""
    models_dir = tmp_path / "whisper"
    svc = ModelService(models_dir)
    assert svc is not None


# ---------------------------------------------------------------------------
# is_installed()
# ---------------------------------------------------------------------------

def test_is_installed_false_when_models_dir_does_not_exist(tmp_path):
    """Returns False when the models_dir itself has never been created."""
    models_dir = tmp_path / "whisper"
    # Do NOT create models_dir
    svc = ModelService(models_dir)
    assert svc.is_installed("tiny") is False


def test_is_installed_false_when_cache_dir_absent(tmp_path):
    """Returns False when models_dir exists but the model's cache dir is absent."""
    models_dir = tmp_path / "whisper"
    models_dir.mkdir(parents=True)
    svc = ModelService(models_dir)
    assert svc.is_installed("base") is False


def test_is_installed_false_when_refs_main_missing(tmp_path):
    """Returns False when cache dir exists but refs/main is not present (incomplete download)."""
    models_dir = tmp_path / "whisper"
    models_dir.mkdir(parents=True)
    install_model_incomplete(models_dir, "small")
    svc = ModelService(models_dir)
    assert svc.is_installed("small") is False


def test_is_installed_true_when_cache_dir_and_refs_main_present(tmp_path):
    """Returns True when cache dir exists and refs/main is present."""
    models_dir = tmp_path / "whisper"
    models_dir.mkdir(parents=True)
    install_model(models_dir, "medium")
    svc = ModelService(models_dir)
    assert svc.is_installed("medium") is True


def test_is_installed_raises_for_unknown_model_id(tmp_path):
    """Raises ValueError when given a model_id not in WHISPER_CATALOG."""
    svc = make_service(tmp_path)
    with pytest.raises(ValueError):
        svc.is_installed("nonexistent-model")


def test_is_installed_true_for_large_v3(tmp_path):
    """large-v3 (hyphenated) is correctly handled."""
    models_dir = tmp_path / "whisper"
    models_dir.mkdir(parents=True)
    install_model(models_dir, "large-v3")
    svc = ModelService(models_dir)
    assert svc.is_installed("large-v3") is True


def test_is_installed_uses_correct_cache_dir_name(tmp_path):
    """The cache directory name is derived from the hf_repo with / replaced by --."""
    models_dir = tmp_path / "whisper"
    models_dir.mkdir(parents=True)

    # Manually create a correctly named dir for tiny
    repo = WHISPER_CATALOG["tiny"]["hf_repo"]
    expected_dir_name = "models--" + repo.replace("/", "--")
    cache = models_dir / expected_dir_name
    refs = cache / "refs"
    refs.mkdir(parents=True)
    (refs / "main").write_text("abc")

    svc = ModelService(models_dir)
    assert svc.is_installed("tiny") is True


# ---------------------------------------------------------------------------
# list_models()
# ---------------------------------------------------------------------------

def test_list_models_returns_at_least_six_entries(tmp_path):
    """list_models() returns at least 6 entries — 5 Whisper + 1 diarization + alignment models."""
    svc = make_service(tmp_path)
    result = svc.list_models()
    assert len(result) >= 6


def test_list_models_contains_all_model_ids(tmp_path):
    """Whisper + diarization IDs all appear in list_models() (alignment models may also be present)."""
    svc = make_service(tmp_path)
    result = svc.list_models()
    ids = {entry["id"] for entry in result}
    assert {"tiny", "base", "small", "medium", "large-v3", "diarize"}.issubset(ids)


def test_list_models_installed_false_when_nothing_on_disk(tmp_path):
    """All entries show installed=False when no models are on disk."""
    svc = make_service(tmp_path)
    result = svc.list_models()
    for entry in result:
        assert entry["installed"] is False, f"{entry['id']} should not be installed"


def test_list_models_installed_reflects_disk_state(tmp_path):
    """installed field is True only for models whose cache dirs + refs/main exist."""
    models_dir = tmp_path / "whisper"
    models_dir.mkdir(parents=True)
    install_model(models_dir, "tiny")
    install_model(models_dir, "large-v3")

    svc = ModelService(models_dir)
    result = svc.list_models()

    installed = {entry["id"]: entry["installed"] for entry in result}
    assert installed["tiny"] is True
    assert installed["large-v3"] is True
    assert installed["base"] is False
    assert installed["small"] is False
    assert installed["medium"] is False


def test_list_models_entry_has_id_and_installed_keys(tmp_path):
    """Each entry in list_models() must have exactly the keys 'id' and 'installed'."""
    svc = make_service(tmp_path)
    result = svc.list_models()
    for entry in result:
        assert "id" in entry, "entry missing 'id'"
        assert "installed" in entry, "entry missing 'installed'"


def test_list_models_incomplete_download_shows_not_installed(tmp_path):
    """A model with a cache dir but no refs/main shows installed=False."""
    models_dir = tmp_path / "whisper"
    models_dir.mkdir(parents=True)
    install_model_incomplete(models_dir, "base")

    svc = ModelService(models_dir)
    result = svc.list_models()
    installed = {entry["id"]: entry["installed"] for entry in result}
    assert installed["base"] is False


# ---------------------------------------------------------------------------
# delete_model()
# ---------------------------------------------------------------------------

def test_delete_model_removes_cache_directory(tmp_path):
    """delete_model() removes the model's cache directory from disk."""
    models_dir = tmp_path / "whisper"
    models_dir.mkdir(parents=True)
    cache = install_model(models_dir, "small")

    svc = ModelService(models_dir)
    assert cache.exists()
    svc.delete_model("small")
    assert not cache.exists()


def test_delete_model_raises_file_not_found_when_not_installed(tmp_path):
    """delete_model() raises FileNotFoundError when the model cache dir does not exist."""
    svc = make_service(tmp_path)
    with pytest.raises(FileNotFoundError):
        svc.delete_model("tiny")


def test_delete_model_raises_value_error_for_unknown_model_id(tmp_path):
    """delete_model() raises ValueError for a model_id not in WHISPER_CATALOG."""
    svc = make_service(tmp_path)
    with pytest.raises(ValueError):
        svc.delete_model("unknown-model")


def test_delete_model_does_not_affect_other_models(tmp_path):
    """Deleting one model leaves other installed models intact."""
    models_dir = tmp_path / "whisper"
    models_dir.mkdir(parents=True)
    install_model(models_dir, "tiny")
    cache_base = install_model(models_dir, "base")

    svc = ModelService(models_dir)
    svc.delete_model("tiny")

    # base must still be present and fully installed
    assert cache_base.exists()
    assert svc.is_installed("base") is True


def test_delete_model_then_is_installed_returns_false(tmp_path):
    """After delete_model(), is_installed() returns False for that model."""
    models_dir = tmp_path / "whisper"
    models_dir.mkdir(parents=True)
    install_model(models_dir, "medium")

    svc = ModelService(models_dir)
    assert svc.is_installed("medium") is True
    svc.delete_model("medium")
    assert svc.is_installed("medium") is False


def test_delete_model_updates_list_models(tmp_path):
    """After deletion, list_models() reports installed=False for that model."""
    models_dir = tmp_path / "whisper"
    models_dir.mkdir(parents=True)
    install_model(models_dir, "small")

    svc = ModelService(models_dir)
    svc.delete_model("small")

    result = svc.list_models()
    installed = {entry["id"]: entry["installed"] for entry in result}
    assert installed["small"] is False
