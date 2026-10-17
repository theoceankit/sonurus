"""Sonorus sends no usage data to third parties: the telemetry of the libraries
it runs (pyannote's OpenTelemetry metrics, Hugging Face) is switched off when
the app package is imported, before any ML library, whatever the user's
environment says."""
import importlib.metadata
import json
import multiprocessing
import os
import subprocess
import sys
from pathlib import Path

import pytest

import pipeline_workers

ROOT = Path(__file__).resolve().parent.parent

TELEMETRY_OFF = {
    "PYANNOTE_METRICS_ENABLED": "false",
    "OTEL_SDK_DISABLED": "true",
    "HF_HUB_DISABLE_TELEMETRY": "1",
    "DO_NOT_TRACK": "1",
}

# What a user (or a .env file) could set to turn telemetry back on.
TELEMETRY_ON = {
    "PYANNOTE_METRICS_ENABLED": "true",
    "OTEL_SDK_DISABLED": "false",
    "HF_HUB_DISABLE_TELEMETRY": "0",
    "DO_NOT_TRACK": "0",
}


def _python(code: str, env_overrides: dict, tmp_path) -> str:
    """Runs code in a fresh interpreter (this one already imported app)."""
    env = {**os.environ, **env_overrides, "SONORUS_DATA_DIR": str(tmp_path)}
    res = subprocess.run(
        [sys.executable, "-c", code], cwd=ROOT, env=env,
        capture_output=True, text=True, timeout=300,
    )
    assert res.returncode == 0, res.stderr
    return res.stdout.strip().splitlines()[-1]


def _env_after(import_line: str, tmp_path, env_overrides=TELEMETRY_ON) -> dict:
    code = (
        f"{import_line}\n"
        "import json, os\n"
        f"print(json.dumps({{k: os.environ.get(k) for k in {list(TELEMETRY_OFF)!r}}}))\n"
    )
    return json.loads(_python(code, env_overrides, tmp_path))


def test_importing_the_app_package_switches_telemetry_off(tmp_path):
    assert _env_after("import app", tmp_path, env_overrides={}) == TELEMETRY_OFF


def test_the_users_environment_cannot_switch_telemetry_back_on(tmp_path):
    assert _env_after("import app", tmp_path) == TELEMETRY_OFF


def test_telemetry_is_off_whichever_app_module_is_imported_first(tmp_path):
    # Python runs app/__init__.py before any app module, so a module that
    # imports pyannote before app.config is covered too.
    assert _env_after("import app.gpu_probe", tmp_path) == TELEMETRY_OFF


def test_this_process_has_telemetry_off():
    # conftest imported app, as the backend does at start-up.
    for name, value in TELEMETRY_OFF.items():
        assert os.environ.get(name) == value, name


def test_the_pipeline_child_process_inherits_telemetry_off():
    ctx = multiprocessing.get_context("spawn")
    parent, child = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=pipeline_workers.env_worker, args=(list(TELEMETRY_OFF), child))
    proc.start()
    try:
        assert parent.poll(60)
        assert parent.recv() == TELEMETRY_OFF
    finally:
        proc.join(10)


def _installed(*dists: str) -> bool:
    # Package metadata, not imports: conftest stubs the ML modules in CI.
    try:
        for dist in dists:
            importlib.metadata.distribution(dist)
    except importlib.metadata.PackageNotFoundError:
        return False
    return True


_HAS_REAL_PYANNOTE = _installed("pyannote.audio", "opentelemetry-sdk", "huggingface_hub")


@pytest.mark.skipif(not _HAS_REAL_PYANNOTE, reason="needs the real pyannote.audio and OpenTelemetry (not in CI)")
def test_pyannote_exports_no_metrics(tmp_path):
    code = (
        "import app\n"
        "import warnings; warnings.filterwarnings('ignore')\n"
        "import pyannote.audio.telemetry.metrics as m\n"
        "calls = []\n"
        "m.exporter.export = lambda data, **kw: calls.append(data) or 0\n"
        "class P: _otel_origin = 'pyannote/speaker-diarization'; _otel_name = 'SpeakerDiarization'\n"
        "m.track_model_init(P()); m.track_pipeline_init(P())\n"
        "m.reader.force_flush()\n"
        "print(len(calls))\n"
    )
    assert _python(code, TELEMETRY_ON, tmp_path) == "0"


@pytest.mark.skipif(not _HAS_REAL_PYANNOTE, reason="needs the real huggingface_hub (not in CI)")
def test_hugging_face_telemetry_is_disabled(tmp_path):
    code = (
        "import app\n"
        "from huggingface_hub import constants\n"
        "print(constants.HF_HUB_DISABLE_TELEMETRY)\n"
    )
    assert _python(code, TELEMETRY_ON, tmp_path) == "True"
