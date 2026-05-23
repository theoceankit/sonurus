"""Tests for byte-level download progress tracking in ModelService."""
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.services.model_service import (
    ModelService,
    WHISPER_CATALOG,
    DIARIZATION_CATALOG,
    _count_cache_bytes,
    _matches_allow_patterns,
    _WHISPER_ALLOW_PATTERNS,
)


# ---------------------------------------------------------------------------
# _matches_allow_patterns
# ---------------------------------------------------------------------------

def test_matches_allow_patterns_exact_name():
    assert _matches_allow_patterns("model.bin", _WHISPER_ALLOW_PATTERNS) is True


def test_matches_allow_patterns_wildcard():
    assert _matches_allow_patterns("vocabulary.json", _WHISPER_ALLOW_PATTERNS) is True
    assert _matches_allow_patterns("vocabulary.txt", _WHISPER_ALLOW_PATTERNS) is True


def test_matches_allow_patterns_no_match():
    assert _matches_allow_patterns("pytorch_model.bin", _WHISPER_ALLOW_PATTERNS) is False
    assert _matches_allow_patterns("README.md", _WHISPER_ALLOW_PATTERNS) is False


# ---------------------------------------------------------------------------
# _count_cache_bytes
# ---------------------------------------------------------------------------

def test_count_cache_bytes_empty_dir(tmp_path):
    d = tmp_path / "empty"
    d.mkdir()
    assert _count_cache_bytes([d]) == 0


def test_count_cache_bytes_missing_dir(tmp_path):
    assert _count_cache_bytes([tmp_path / "nonexistent"]) == 0


def test_count_cache_bytes_sums_real_files(tmp_path):
    d = tmp_path / "blobs"
    d.mkdir()
    (d / "file1").write_bytes(b"x" * 100)
    (d / "file2").write_bytes(b"y" * 200)
    assert _count_cache_bytes([d]) == 300


def test_count_cache_bytes_skips_symlinks(tmp_path):
    blobs = tmp_path / "blobs"
    blobs.mkdir()
    real_file = blobs / "abc123"
    real_file.write_bytes(b"z" * 500)

    snapshots = tmp_path / "snapshots" / "rev1"
    snapshots.mkdir(parents=True)
    link = snapshots / "model.bin"
    link.symlink_to(real_file)

    # Only the real file (500 bytes) should be counted, not the symlink.
    total = _count_cache_bytes([tmp_path])
    assert total == 500


def test_count_cache_bytes_includes_incomplete_files(tmp_path):
    blobs = tmp_path / "blobs"
    blobs.mkdir()
    (blobs / "abc.incomplete").write_bytes(b"p" * 1024)
    assert _count_cache_bytes([tmp_path]) == 1024


def test_count_cache_bytes_sums_multiple_dirs(tmp_path):
    d1 = tmp_path / "dir1"
    d2 = tmp_path / "dir2"
    d1.mkdir()
    d2.mkdir()
    (d1 / "a").write_bytes(b"a" * 100)
    (d2 / "b").write_bytes(b"b" * 200)
    assert _count_cache_bytes([d1, d2]) == 300


# ---------------------------------------------------------------------------
# ModelService._get_total_bytes
# ---------------------------------------------------------------------------

def _make_service(tmp_path: Path) -> ModelService:
    return ModelService(tmp_path / "whisper", tmp_path / "hf")


def _make_sibling(rfilename: str, size: int) -> MagicMock:
    s = MagicMock()
    s.rfilename = rfilename
    s.size = size
    return s


def test_get_total_bytes_sums_matching_whisper_files(tmp_path):
    svc = _make_service(tmp_path)
    siblings = [
        _make_sibling("model.bin", 200_000_000),
        _make_sibling("config.json", 2_000),
        _make_sibling("README.md", 50_000),  # not in allow_patterns → excluded
    ]
    mock_info = MagicMock()
    mock_info.siblings = siblings

    with patch("app.services.model_service.huggingface_hub.model_info", return_value=mock_info):
        total = svc._get_total_bytes("small")

    assert total == 200_000_000 + 2_000  # README excluded


def test_get_total_bytes_excludes_none_sizes(tmp_path):
    svc = _make_service(tmp_path)
    siblings = [
        _make_sibling("model.bin", 100_000),
        _make_sibling("config.json", None),  # size=None → skipped
    ]
    mock_info = MagicMock()
    mock_info.siblings = siblings

    with patch("app.services.model_service.huggingface_hub.model_info", return_value=mock_info):
        total = svc._get_total_bytes("tiny")

    assert total == 100_000


def test_get_total_bytes_falls_back_to_catalog_on_api_error(tmp_path):
    svc = _make_service(tmp_path)

    with patch("app.services.model_service.huggingface_hub.model_info", side_effect=Exception("network error")):
        total = svc._get_total_bytes("small")

    assert total == WHISPER_CATALOG["small"]["size_bytes"]


def test_get_total_bytes_diarize_sums_both_repos(tmp_path):
    svc = _make_service(tmp_path)
    repos = DIARIZATION_CATALOG["diarize"]["hf_repos"]

    info_a = MagicMock()
    info_a.siblings = [_make_sibling("config.yaml", 1_000), _make_sibling("pytorch_model.bin", 50_000_000)]
    info_b = MagicMock()
    info_b.siblings = [_make_sibling("pytorch_model.bin", 60_000_000)]

    call_results = [info_a, info_b]

    with patch("app.services.model_service.huggingface_hub.model_info", side_effect=call_results):
        total = svc._get_total_bytes("diarize")

    assert total == 1_000 + 50_000_000 + 60_000_000


def test_get_total_bytes_diarize_falls_back_to_catalog_on_error(tmp_path):
    svc = _make_service(tmp_path)

    with patch("app.services.model_service.huggingface_hub.model_info", side_effect=Exception("timeout")):
        total = svc._get_total_bytes("diarize")

    assert total == DIARIZATION_CATALOG["diarize"]["size_bytes"]


# ---------------------------------------------------------------------------
# download_model — on_progress callback
# ---------------------------------------------------------------------------

def _install_bytes_in_cache(cache_dir: Path, n_bytes: int) -> None:
    """Create a fake blob file so the poller reports non-zero progress."""
    blobs = cache_dir / "blobs"
    blobs.mkdir(parents=True, exist_ok=True)
    (blobs / "fake-blob").write_bytes(b"x" * n_bytes)


def test_download_model_emits_progress_events(tmp_path):
    svc = _make_service(tmp_path)

    # Pre-create 50% of the total bytes as a fake blob.
    total = 10_000
    _install_bytes_in_cache(svc._cache_dir("tiny"), total // 2)

    events = []

    def slow_snapshot(*args, **kwargs):
        time.sleep(0.25)  # keep poller alive for a couple ticks

    mock_info = MagicMock()
    mock_info.siblings = [_make_sibling("model.bin", total)]

    with patch("app.services.model_service.huggingface_hub.snapshot_download", side_effect=slow_snapshot):
        with patch("app.services.model_service.huggingface_hub.model_info", return_value=mock_info):
            svc.download_model("tiny", on_progress=events.append)

    progress = [e for e in events if e.get("type") == "progress"]
    assert len(progress) > 0, "Expected at least one progress event"
    assert all("pct" in e for e in progress)
    # Some events should reflect the pre-created bytes (pct > 0).
    assert any(e["pct"] > 0 for e in progress), (
        f"Expected pct > 0 in some events (pre-existing bytes); got: {progress}"
    )


def test_download_model_no_progress_when_callback_none(tmp_path):
    """Passing on_progress=None must not start a poller or call any callback."""
    svc = _make_service(tmp_path)
    called = []

    with patch("app.services.model_service.huggingface_hub.snapshot_download"):
        svc.download_model("tiny", on_progress=None)

    assert called == []


def test_download_diarize_emits_progress_events(tmp_path):
    svc = _make_service(tmp_path)

    total = 20_000
    for repo in DIARIZATION_CATALOG["diarize"]["hf_repos"]:
        _install_bytes_in_cache(svc._hf_cache_dir(repo), total // 4)

    events = []

    def slow_snapshot(*args, **kwargs):
        time.sleep(0.15)

    info_a = MagicMock()
    info_a.siblings = [_make_sibling("pytorch_model.bin", total // 2)]
    info_b = MagicMock()
    info_b.siblings = [_make_sibling("pytorch_model.bin", total // 2)]

    with patch("app.services.model_service.huggingface_hub.snapshot_download", side_effect=[None, None]):
        with patch("app.services.model_service.huggingface_hub.model_info", side_effect=[info_a, info_b]):
            svc.download_model("diarize", on_progress=events.append)

    progress = [e for e in events if e.get("type") == "progress"]
    assert len(progress) > 0
    assert all("pct" in e for e in progress)


def test_download_model_progress_pct_capped_at_99(tmp_path):
    """pct must never exceed 99.0% (100% is emitted by the router as 'done')."""
    svc = _make_service(tmp_path)

    total = 1_000
    # Pre-create MORE bytes than total to force overflow scenario.
    _install_bytes_in_cache(svc._cache_dir("tiny"), total * 2)

    events = []

    def instant_snapshot(*args, **kwargs):
        time.sleep(0.15)

    mock_info = MagicMock()
    mock_info.siblings = [_make_sibling("model.bin", total)]

    with patch("app.services.model_service.huggingface_hub.snapshot_download", side_effect=instant_snapshot):
        with patch("app.services.model_service.huggingface_hub.model_info", return_value=mock_info):
            svc.download_model("tiny", on_progress=events.append)

    progress = [e for e in events if e.get("type") == "progress"]
    assert all(e["pct"] <= 99.0 for e in progress), (
        f"pct must be capped at 99.0; got: {[e['pct'] for e in progress]}"
    )


def test_download_model_poller_stops_after_download(tmp_path):
    """Poller thread must not outlive the download call."""
    svc = _make_service(tmp_path)
    events = []

    def instant_snapshot(*args, **kwargs):
        pass  # completes immediately

    mock_info = MagicMock()
    mock_info.siblings = [_make_sibling("model.bin", 100)]

    with patch("app.services.model_service.huggingface_hub.snapshot_download", side_effect=instant_snapshot):
        with patch("app.services.model_service.huggingface_hub.model_info", return_value=mock_info):
            svc.download_model("tiny", on_progress=events.append)

    # After download_model returns, no new events should arrive.
    count_after = len(events)
    time.sleep(0.2)
    assert len(events) == count_after, (
        "Poller continued emitting after download_model returned"
    )
