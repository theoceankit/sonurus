"""Tests for alignment model management in ModelService.

Covers ALIGNMENT_CATALOG structure, ModelService alignment methods
(is_installed, list_models, delete_model, download_model), and
the third constructor parameter alignment_models_dir.
"""
import threading
from pathlib import Path
from unittest.mock import patch, call

import pytest

from app.services.model_service import ModelService, ALIGNMENT_CATALOG


# ---------------------------------------------------------------------------
# Helpers / factories
# ---------------------------------------------------------------------------

EXPECTED_LANG_CODES = {"ru", "zh", "ja", "ko", "uk", "pt", "ar", "nl", "pl", "hi"}


def make_service(tmp_path: Path) -> ModelService:
    """Return a ModelService with separate whisper, hf, and alignment dirs."""
    whisper_dir = tmp_path / "whisper"
    hf_dir = tmp_path / "hf"
    alignment_dir = tmp_path / "alignment"
    return ModelService(whisper_dir, hf_dir, alignment_dir)


def _alignment_refs_path(alignment_dir: Path, lang_code: str) -> Path:
    """Return the expected refs/main path for a given alignment lang_code."""
    hf_repo = ALIGNMENT_CATALOG[lang_code]["hf_repo"]
    return alignment_dir / ("models--" + hf_repo.replace("/", "--")) / "refs" / "main"


def _install_alignment(alignment_dir: Path, lang_code: str) -> None:
    """Simulate a fully installed alignment model by creating refs/main."""
    refs_main = _alignment_refs_path(alignment_dir, lang_code)
    refs_main.parent.mkdir(parents=True, exist_ok=True)
    refs_main.write_text("abc123")


# ---------------------------------------------------------------------------
# ALIGNMENT_CATALOG structure
# ---------------------------------------------------------------------------

def test_alignment_catalog_exists():
    """ALIGNMENT_CATALOG must be importable from model_service."""
    assert ALIGNMENT_CATALOG is not None


def test_alignment_catalog_contains_all_expected_language_codes():
    """ALIGNMENT_CATALOG must include ru, zh, ja, ko, uk, pt, ar, nl, pl, hi."""
    missing = EXPECTED_LANG_CODES - set(ALIGNMENT_CATALOG.keys())
    assert not missing, f"ALIGNMENT_CATALOG is missing language codes: {missing}"


def test_alignment_catalog_entries_have_hf_repo():
    """Every ALIGNMENT_CATALOG entry must have an 'hf_repo' key with a non-empty string."""
    for lang, entry in ALIGNMENT_CATALOG.items():
        assert "hf_repo" in entry, f"Entry for '{lang}' is missing 'hf_repo'"
        assert isinstance(entry["hf_repo"], str), f"hf_repo for '{lang}' must be a str"
        assert entry["hf_repo"], f"hf_repo for '{lang}' must not be empty"


def test_alignment_catalog_entries_have_size_bytes():
    """Every ALIGNMENT_CATALOG entry must have a positive 'size_bytes' integer."""
    for lang, entry in ALIGNMENT_CATALOG.items():
        assert "size_bytes" in entry, f"Entry for '{lang}' is missing 'size_bytes'"
        assert isinstance(entry["size_bytes"], int), f"size_bytes for '{lang}' must be an int"
        assert entry["size_bytes"] > 0, f"size_bytes for '{lang}' must be positive"


def test_alignment_catalog_ru_entry_has_valid_hf_repo():
    """ALIGNMENT_CATALOG['ru'] must have a recognisable HuggingFace repo string."""
    assert "ru" in ALIGNMENT_CATALOG
    assert "/" in ALIGNMENT_CATALOG["ru"]["hf_repo"], (
        "hf_repo should be in 'owner/name' format"
    )


# ---------------------------------------------------------------------------
# ModelService constructor — alignment_models_dir parameter
# ---------------------------------------------------------------------------

def test_constructor_accepts_alignment_models_dir(tmp_path):
    """ModelService accepts a third argument alignment_models_dir without raising."""
    whisper_dir = tmp_path / "whisper"
    hf_dir = tmp_path / "hf"
    alignment_dir = tmp_path / "alignment"
    svc = ModelService(whisper_dir, hf_dir, alignment_dir)
    assert svc is not None


def test_constructor_defaults_alignment_dir_to_models_parent_alignment(tmp_path):
    """When alignment_models_dir is omitted, it defaults to models_dir.parent / 'alignment'."""
    whisper_dir = tmp_path / "whisper"
    hf_dir = tmp_path / "hf"
    svc = ModelService(whisper_dir, hf_dir)
    # We verify the default by checking that is_installed works with the derived dir.
    # Install into the expected default location.
    default_alignment_dir = whisper_dir.parent / "alignment"
    lang = "ru"
    _install_alignment(default_alignment_dir, lang)
    assert svc.is_installed(lang) is True


# ---------------------------------------------------------------------------
# ModelService.is_installed() for alignment models
# ---------------------------------------------------------------------------

def test_is_installed_alignment_false_when_alignment_dir_empty(tmp_path):
    """Returns False when no alignment cache dirs exist."""
    svc = make_service(tmp_path)
    assert svc.is_installed("ru") is False


def test_is_installed_alignment_false_when_cache_dir_exists_but_no_refs_main(tmp_path):
    """Returns False when cache dir exists but refs/main is absent (incomplete download)."""
    alignment_dir = tmp_path / "alignment"
    hf_repo = ALIGNMENT_CATALOG["zh"]["hf_repo"]
    cache_dir = alignment_dir / ("models--" + hf_repo.replace("/", "--"))
    cache_dir.mkdir(parents=True)
    # No refs/main created
    svc = make_service(tmp_path)
    assert svc.is_installed("zh") is False


def test_is_installed_alignment_true_when_refs_main_exists(tmp_path):
    """Returns True when refs/main exists for the alignment model's hf_repo."""
    alignment_dir = tmp_path / "alignment"
    _install_alignment(alignment_dir, "ru")
    svc = make_service(tmp_path)
    assert svc.is_installed("ru") is True


def test_is_installed_alignment_true_for_various_languages(tmp_path):
    """is_installed returns True for each language code once refs/main is created."""
    alignment_dir = tmp_path / "alignment"
    for lang in ["zh", "ja", "ko", "uk"]:
        _install_alignment(alignment_dir, lang)
    svc = make_service(tmp_path)
    for lang in ["zh", "ja", "ko", "uk"]:
        assert svc.is_installed(lang) is True, f"Expected is_installed('{lang}') to be True"


def test_is_installed_unknown_lang_raises_value_error(tmp_path):
    """is_installed raises ValueError for a language code not in any catalog."""
    svc = make_service(tmp_path)
    with pytest.raises(ValueError):
        svc.is_installed("xx_unknown")


# ---------------------------------------------------------------------------
# ModelService.list_models() includes alignment entries
# ---------------------------------------------------------------------------

def test_list_models_includes_alignment_language_codes(tmp_path):
    """list_models() must include at least one entry per language in ALIGNMENT_CATALOG."""
    svc = make_service(tmp_path)
    ids = {e["id"] for e in svc.list_models()}
    for lang in EXPECTED_LANG_CODES:
        assert lang in ids, f"Expected language code '{lang}' in list_models() result"


def test_list_models_alignment_installed_false_on_clean_dir(tmp_path):
    """All alignment entries show installed=False when no alignment models are on disk."""
    svc = make_service(tmp_path)
    result = {e["id"]: e["installed"] for e in svc.list_models()}
    for lang in EXPECTED_LANG_CODES:
        assert result[lang] is False, f"'{lang}' should be installed=False on clean dir"


def test_list_models_alignment_installed_true_when_on_disk(tmp_path):
    """list_models() shows installed=True for 'ru' once refs/main exists."""
    alignment_dir = tmp_path / "alignment"
    _install_alignment(alignment_dir, "ru")
    svc = make_service(tmp_path)
    result = {e["id"]: e["installed"] for e in svc.list_models()}
    assert result["ru"] is True


def test_list_models_alignment_entries_have_id_and_installed_keys(tmp_path):
    """Each alignment entry in list_models() must have 'id' and 'installed' keys."""
    svc = make_service(tmp_path)
    for entry in svc.list_models():
        if entry["id"] in ALIGNMENT_CATALOG:
            assert "id" in entry
            assert "installed" in entry


def test_list_models_total_count_includes_alignment(tmp_path):
    """list_models() total count = 5 Whisper + 1 diarize + len(ALIGNMENT_CATALOG)."""
    svc = make_service(tmp_path)
    result = svc.list_models()
    expected_count = 5 + 1 + len(ALIGNMENT_CATALOG)
    assert len(result) == expected_count, (
        f"Expected {expected_count} entries (5 whisper + 1 diarize + {len(ALIGNMENT_CATALOG)} alignment), "
        f"got {len(result)}"
    )


# ---------------------------------------------------------------------------
# ModelService.delete_model() for alignment models
# ---------------------------------------------------------------------------

def test_delete_alignment_removes_cache_dir(tmp_path):
    """delete_model(lang) removes the alignment model's cache directory."""
    alignment_dir = tmp_path / "alignment"
    _install_alignment(alignment_dir, "ru")
    hf_repo = ALIGNMENT_CATALOG["ru"]["hf_repo"]
    cache_dir = alignment_dir / ("models--" + hf_repo.replace("/", "--"))
    assert cache_dir.exists()

    svc = make_service(tmp_path)
    svc.delete_model("ru")

    assert not cache_dir.exists(), (
        f"Cache dir {cache_dir} should be removed after delete_model('ru')"
    )


def test_delete_alignment_after_delete_is_installed_returns_false(tmp_path):
    """After delete_model(lang), is_installed(lang) returns False."""
    alignment_dir = tmp_path / "alignment"
    _install_alignment(alignment_dir, "ja")
    svc = make_service(tmp_path)
    assert svc.is_installed("ja") is True
    svc.delete_model("ja")
    assert svc.is_installed("ja") is False


def test_delete_alignment_raises_file_not_found_when_not_installed(tmp_path):
    """delete_model(lang) raises FileNotFoundError when the alignment model is not installed."""
    svc = make_service(tmp_path)
    with pytest.raises(FileNotFoundError):
        svc.delete_model("ko")


def test_delete_alignment_raises_value_error_for_unknown_lang(tmp_path):
    """delete_model raises ValueError for a lang code not in any catalog."""
    svc = make_service(tmp_path)
    with pytest.raises(ValueError):
        svc.delete_model("xx_unknown_lang")


def test_delete_alignment_does_not_affect_other_alignment_models(tmp_path):
    """Deleting one alignment model does not affect other installed alignment models."""
    alignment_dir = tmp_path / "alignment"
    _install_alignment(alignment_dir, "ru")
    _install_alignment(alignment_dir, "zh")

    svc = make_service(tmp_path)
    svc.delete_model("ru")

    assert svc.is_installed("ru") is False
    assert svc.is_installed("zh") is True


# ---------------------------------------------------------------------------
# ModelService.download_model() for alignment models
# ---------------------------------------------------------------------------

def test_download_alignment_calls_snapshot_download(tmp_path):
    """download_model(lang) calls huggingface_hub.snapshot_download once."""
    svc = make_service(tmp_path)

    with patch("app.services.model_service.huggingface_hub.snapshot_download") as mock_dl:
        svc.download_model("ru")

    mock_dl.assert_called_once()


def test_download_alignment_passes_correct_hf_repo(tmp_path):
    """download_model(lang) calls snapshot_download with the hf_repo from ALIGNMENT_CATALOG."""
    svc = make_service(tmp_path)
    expected_repo = ALIGNMENT_CATALOG["ru"]["hf_repo"]
    captured_repos = []

    def fake_download(repo, **kwargs):
        captured_repos.append(repo)

    with patch("app.services.model_service.huggingface_hub.snapshot_download", side_effect=fake_download):
        svc.download_model("ru")

    assert len(captured_repos) == 1
    assert captured_repos[0] == expected_repo


def test_download_alignment_passes_alignment_dir_as_cache_dir(tmp_path):
    """download_model(lang) passes str(alignment_models_dir) as cache_dir."""
    alignment_dir = tmp_path / "alignment"
    svc = make_service(tmp_path)
    captured_cache_dirs = []

    def fake_download(repo, cache_dir=None, **kwargs):
        captured_cache_dirs.append(cache_dir)

    with patch("app.services.model_service.huggingface_hub.snapshot_download", side_effect=fake_download):
        svc.download_model("ru")

    assert len(captured_cache_dirs) == 1
    assert captured_cache_dirs[0] == str(alignment_dir), (
        f"Expected cache_dir={str(alignment_dir)!r}, got {captured_cache_dirs[0]!r}"
    )


def test_download_alignment_unknown_lang_raises_value_error(tmp_path):
    """download_model raises ValueError for a lang code not in any catalog."""
    svc = make_service(tmp_path)
    with pytest.raises(ValueError):
        svc.download_model("xx_unknown_lang")


def test_download_alignment_respects_cancel_event_before_download(tmp_path):
    """download_model raises CancelledError immediately when cancel_event is already set."""
    from asyncio import CancelledError
    svc = make_service(tmp_path)
    cancel = threading.Event()
    cancel.set()

    with patch("app.services.model_service.huggingface_hub.snapshot_download") as mock_dl:
        with pytest.raises(CancelledError):
            svc.download_model("ru", cancel_event=cancel)
        mock_dl.assert_not_called()


def test_download_alignment_starts_progress_poller_thread(tmp_path):
    """When on_progress is provided, a background polling thread is started."""
    svc = make_service(tmp_path)
    threads_started = []

    original_start = threading.Thread.start

    def mock_start(self, *args, **kwargs):
        threads_started.append(self)
        original_start(self, *args, **kwargs)

    progress_events = []

    def fake_download(repo, **kwargs):
        pass

    with patch("app.services.model_service.huggingface_hub.snapshot_download", side_effect=fake_download):
        with patch.object(threading.Thread, "start", mock_start):
            svc.download_model("ru", on_progress=progress_events.append)

    assert len(threads_started) >= 1, (
        "Expected at least one background thread to be started when on_progress is provided"
    )


def test_download_alignment_no_progress_poller_when_on_progress_none(tmp_path):
    """When on_progress is None, no extra background thread is started for progress polling."""
    svc = make_service(tmp_path)
    threads_started = []

    original_start = threading.Thread.start

    def mock_start(self, *args, **kwargs):
        threads_started.append(self)
        original_start(self, *args, **kwargs)

    with patch("app.services.model_service.huggingface_hub.snapshot_download"):
        with patch.object(threading.Thread, "start", mock_start):
            svc.download_model("ru")

    assert len(threads_started) == 0, (
        f"Expected no background polling threads when on_progress=None, "
        f"but {len(threads_started)} threads were started"
    )
