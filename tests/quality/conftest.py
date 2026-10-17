"""Quality tests: real models on the AMI set, run only on request.

    .venv/bin/python scripts/eval/build_ami_set.py --chromium   # once
    SONORUS_QUALITY=1 .venv/bin/python -m pytest tests/quality -v -s

Skipped unless SONORUS_QUALITY=1, when the ML libraries are the CI stubs, and
when the set is not built. Models are read from SONORUS_MODELS_DIR (default:
the dev app's ~/.config/sonorus-dev/.models); speaker memory and transcripts
go to a temporary database, nothing of the user's data is touched.
"""
import os
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from tests.quality import report

HERE = Path(__file__).parent


def models_dir() -> Path:
    return Path(os.getenv("SONORUS_MODELS_DIR", Path.home() / ".config" / "sonorus-dev" / ".models"))


def _skip_reason() -> str | None:
    if os.getenv("SONORUS_QUALITY") != "1":
        return "quality tests run only with SONORUS_QUALITY=1"
    if isinstance(sys.modules.get("whisperx"), MagicMock):
        return "ML libraries are stubs (CI environment)"
    from tests.quality.harness import set_dir
    if not (set_dir() / "es2002b" / "clean.wav").exists():
        return f"AMI set not built in {set_dir()}: run scripts/eval/build_ami_set.py --chromium"
    if not (models_dir() / "whisper").is_dir():
        return f"no models in {models_dir()} (set SONORUS_MODELS_DIR)"
    return None


def pytest_collection_modifyitems(config, items):
    reason = None
    for item in items:
        if HERE not in Path(item.fspath).parents:
            continue
        item.add_marker(pytest.mark.quality)
        if reason is None:
            reason = _skip_reason() or ""
        if reason:
            item.add_marker(pytest.mark.skip(reason=reason))


def pytest_terminal_summary(terminalreporter):
    if not report.ROWS and not report.NOTES:
        return
    text = report.markdown()
    path = report.write(text)
    terminalreporter.write_sep("=", "audio quality report")
    terminalreporter.write_line(text)
    terminalreporter.write_line(f"saved to {path}")


@pytest.fixture(scope="session")
def pipeline():
    # tests/conftest.py stubs snapshot_download for the whole session (no test
    # may touch the network). The models here are real: resolve them from the
    # local cache in offline mode, as the pipeline child does — still no network.
    import huggingface_hub
    from huggingface_hub import _snapshot_download, constants
    constants.HF_HUB_OFFLINE = True
    huggingface_hub.snapshot_download = _snapshot_download.snapshot_download

    from tests.quality.harness import Pipeline
    started = time.monotonic()
    p = Pipeline(models_dir())
    report.note(f"models loaded in {time.monotonic() - started:.0f} s from {models_dir()} (device {p.device})")
    return p
