"""A job never downloads models: its Whisper model and the diarization model
must be installed before it starts (structured failure otherwise), and the
pipeline child loads models from the local cache only (HF_HUB_OFFLINE)."""
import os
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.services.model_service import (
    DIARIZATION_CATALOG, WHISPER_CATALOG, ModelNotInstalledError, ModelService, require_job_models,
)
from app.services.pipeline_process import _pipeline_worker
from app.services.transcription_job import make_job_runner
from queue_helpers import wait_for
from test_transcription_queue import _add, env, titles  # noqa: F401  (env is a fixture)


def _install(root: Path, repo: str) -> None:
    refs = root / ("models--" + repo.replace("/", "--")) / "refs"
    refs.mkdir(parents=True, exist_ok=True)
    (refs / "main").write_text("abc123")


@pytest.fixture
def models(tmp_path):
    service = ModelService(tmp_path / "whisper", tmp_path / "hf", tmp_path / "alignment")

    def install(*ids):
        for model_id in ids:
            if model_id == "diarize":
                for repo in DIARIZATION_CATALOG["diarize"]["hf_repos"]:
                    _install(tmp_path / "hf", repo)
            else:
                _install(tmp_path / "whisper", WHISPER_CATALOG[model_id]["hf_repo"])
    return service, install


# ── require_job_models ─────────────────────────────────────────────────────────

def test_a_missing_whisper_model_is_reported_first(models):
    service, install = models
    with pytest.raises(ModelNotInstalledError) as exc:
        require_job_models(service, "small")
    assert (exc.value.code, exc.value.model_id) == ("whisper_model_missing", "small")
    assert str(exc.value) == 'Whisper model "small" is not installed. Download it in Settings.'


def test_a_missing_diarization_model(models):
    service, install = models
    install("small")
    with pytest.raises(ModelNotInstalledError) as exc:
        require_job_models(service, "small")
    assert (exc.value.code, exc.value.model_id) == ("diarization_model_missing", "diarize")
    assert str(exc.value) == "Diarization model is not installed. Download it in Settings."


def test_all_models_installed(models):
    service, install = models
    install("small", "diarize")
    require_job_models(service, "small")


# ── run_job checks before the pipeline ─────────────────────────────────────────

JOB = {"id": "j1", "audio_path": "/rec/a.wav", "title": "Sync", "whisper_model": "small", "language": None}


def test_run_job_checks_the_models_before_the_pipeline(tmp_path):
    run = make_job_runner(storage=MagicMock(), memory_db_path=str(tmp_path / "m.db"), on_saved=lambda: None)
    error = ModelNotInstalledError("whisper_model_missing", "small")
    with patch("app.services.transcription_job.require_job_models", side_effect=error) as check, \
         patch("app.services.transcription_job.create_controller") as create, \
         patch("app.services.transcription_job.run_pipeline_process") as child:
        with pytest.raises(ModelNotInstalledError):
            run(JOB, lambda step: None, threading.Event())
    assert check.call_args.args[1] == "small"
    create.assert_not_called()
    child.assert_not_called()


# ── The queue: a structured failure ────────────────────────────────────────────

@pytest.mark.parametrize("code,model_id", [("whisper_model_missing", "small"), ("diarization_model_missing", "diarize")])
def test_a_missing_model_fails_the_job_with_its_code(env, code, model_id):  # noqa: F811
    make, _, runner, recordings = env
    q = make()
    events = []
    q.subscribe(lambda e: events.append(e))
    runner.outcomes["a"] = ModelNotInstalledError(code, model_id)
    _add(q, recordings, "a")
    _add(q, recordings, "b")
    q.start()
    wait_for(lambda: titles(q, "failed") == ["a"] and titles(q) == ["a"])
    job = q.snapshot()["jobs"][0]
    assert (job["status"], job["error_code"], job["error_language"]) == ("failed", code, None)
    assert job["error"] == str(ModelNotInstalledError(code, model_id))
    failed = [e for e in events if e.get("type") == "job_failed"]
    assert failed[0]["error_code"] == code


# ── The pipeline child works offline ───────────────────────────────────────────

def test_the_pipeline_child_loads_models_offline(monkeypatch):
    monkeypatch.setenv("HF_HUB_OFFLINE", "0")   # restored (unset) after the test
    monkeypatch.delenv("HF_HUB_OFFLINE")
    seen = {}

    def create_controller(**kw):
        seen["offline"] = os.environ.get("HF_HUB_OFFLINE")
        raise RuntimeError("stop here")

    class Conn:
        def send(self, msg):
            pass

    with patch("app.services.service_factory.create_controller", side_effect=create_controller):
        _pipeline_worker({"audio_path": "/a.wav", "whisper_model": "small", "language": None, "db_path": "/m.db"}, Conn())
    assert seen["offline"] == "1"
