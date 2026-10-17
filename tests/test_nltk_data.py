"""Alignment works offline: WhisperX splits sentences with NLTK's punkt_tab
data, which ships inside the app's Python (<sys.prefix>/nltk_data) instead of
being downloaded from GitHub into ~/nltk_data on the first alignment.

scripts/fetch_nltk_data.py installs the data (the installer build runs it with
the bundled Python, a source checkout with .venv/bin/python); the pipeline
process limits NLTK to that directory and refuses any download."""
import hashlib
import importlib.util
import io
import re
import sys
import types
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app import nltk_data
from app.nltk_data import NLTK_DATA_DIR, NltkDataMissingError, use_bundled_nltk_data
from app.services.pipeline_process import _pipeline_worker

ROOT = Path(__file__).resolve().parent.parent

_spec = importlib.util.spec_from_file_location("fetch_nltk_data", ROOT / "scripts" / "fetch_nltk_data.py")
fetch = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fetch)


def _archive(members: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    return buf.getvalue()


PUNKT = _archive({
    "punkt_tab/README": "punkt",
    "punkt_tab/english/collocations.tab": "en",
    "punkt_tab/russian/collocations.tab": "ru",
})
PUNKT_SHA = hashlib.sha256(PUNKT).hexdigest()


class _Fetch:
    """Stands in for the HTTP download: counts calls, returns fixed bytes."""

    def __init__(self, data: bytes):
        self.data = data
        self.urls = []

    def __call__(self, url):
        self.urls.append(url)
        return self.data


def _install(dest, cache=None, data=PUNKT, sha=PUNKT_SHA):
    get = _Fetch(data)
    fetch.install(dest, cache_dir=cache, url="https://example.test/punkt_tab.zip", sha256=sha, fetch=get)
    return get


# ── scripts/fetch_nltk_data.py ────────────────────────────────────────────────

def test_the_archive_is_pinned_to_a_commit_with_its_checksum():
    assert re.fullmatch(r"https://raw\.githubusercontent\.com/nltk/nltk_data/[0-9a-f]{40}/"
                        r"packages/tokenizers/punkt_tab\.zip", fetch.PUNKT_TAB_URL)
    assert re.fullmatch(r"[0-9a-f]{64}", fetch.PUNKT_TAB_SHA256)


def test_installs_punkt_tab_under_tokenizers(tmp_path):
    _install(tmp_path / "nltk_data")
    tab = tmp_path / "nltk_data" / "tokenizers" / "punkt_tab"
    assert (tab / "english" / "collocations.tab").read_text() == "en"
    assert (tab / "russian" / "collocations.tab").read_text() == "ru"


def test_default_destination_is_the_running_pythons_prefix():
    assert fetch.default_dest() == Path(sys.prefix) / "nltk_data"
    assert NLTK_DATA_DIR == Path(sys.prefix) / "nltk_data"


def test_a_wrong_checksum_installs_nothing(tmp_path):
    with pytest.raises(ValueError, match="sha256"):
        _install(tmp_path / "nltk_data", sha="0" * 64)
    assert not (tmp_path / "nltk_data" / "tokenizers" / "punkt_tab").exists()


def test_a_reinstall_replaces_the_old_data(tmp_path):
    stale = tmp_path / "nltk_data" / "tokenizers" / "punkt_tab" / "klingon"
    stale.mkdir(parents=True)
    _install(tmp_path / "nltk_data")
    assert not stale.exists()
    assert (stale.parent / "english").is_dir()


def test_a_cached_archive_is_reused_without_downloading(tmp_path):
    cache = tmp_path / "cache"
    assert len(_install(tmp_path / "a", cache=cache).urls) == 1
    assert len(_install(tmp_path / "b", cache=cache).urls) == 0
    assert (tmp_path / "b" / "tokenizers" / "punkt_tab" / "english").is_dir()


def test_a_corrupt_cached_archive_is_downloaded_again(tmp_path):
    cache = tmp_path / "cache"
    _install(tmp_path / "a", cache=cache)
    for cached in cache.iterdir():
        cached.write_bytes(b"garbage")
    assert len(_install(tmp_path / "b", cache=cache).urls) == 1
    assert (tmp_path / "b" / "tokenizers" / "punkt_tab" / "english").is_dir()


@pytest.mark.parametrize("member", ["../evil.txt", "/etc/evil.txt", "other/file.txt"])
def test_members_outside_punkt_tab_are_refused(tmp_path, member):
    data = _archive({"punkt_tab/english/collocations.tab": "en", member: "x"})
    with pytest.raises(ValueError, match="unexpected"):
        _install(tmp_path / "nltk_data", data=data, sha=hashlib.sha256(data).hexdigest())
    assert not (tmp_path / "nltk_data" / "tokenizers" / "punkt_tab").exists()
    assert not (tmp_path / "evil.txt").exists()


# ── app/nltk_data.py ──────────────────────────────────────────────────────────

def _fake_nltk():
    mod = types.ModuleType("nltk")
    mod.data = types.SimpleNamespace(path=["/home/user/nltk_data", "/usr/share/nltk_data"])
    mod.download = MagicMock(name="download")
    return mod


def test_nltk_looks_only_in_the_apps_python():
    fake = _fake_nltk()
    with patch.dict(sys.modules, {"nltk": fake}):
        use_bundled_nltk_data()
    assert fake.data.path == [str(NLTK_DATA_DIR)]


def test_nltk_never_downloads_and_says_what_is_missing():
    fake = _fake_nltk()
    original = fake.download
    with patch.dict(sys.modules, {"nltk": fake}):
        use_bundled_nltk_data()
        with pytest.raises(NltkDataMissingError) as exc:
            fake.download("punkt_tab", quiet=True)
    original.assert_not_called()
    msg = str(exc.value)
    assert "punkt_tab" in msg and str(NLTK_DATA_DIR) in msg
    assert "fetch_nltk_data.py" in msg  # how to fix it from source
    assert isinstance(exc.value, RuntimeError)


def test_without_nltk_installed_it_is_a_no_op():
    with patch.dict(sys.modules, {"nltk": None}):
        use_bundled_nltk_data()  # CI has no ML libraries


def test_the_pipeline_process_limits_nltk_before_the_models_load():
    calls = []
    controller = MagicMock()
    controller.run_pipeline.side_effect = lambda *a, **k: calls.append("pipeline")

    with patch.object(nltk_data, "use_bundled_nltk_data", side_effect=lambda: calls.append("nltk")), \
         patch("app.services.service_factory.create_controller",
               side_effect=lambda **k: calls.append("controller") or (controller, MagicMock())):
        _pipeline_worker({"audio_path": "/a.wav", "whisper_model": "small", "language": None,
                          "db_path": "/x.db"}, MagicMock())
    assert calls == ["nltk", "controller", "pipeline"]
