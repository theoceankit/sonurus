"""CPU or GPU, chosen in Settings → GPU acceleration: the choice is kept in the
backend (app_settings), read when each transcription job starts and passed to
its pipeline child; a running job keeps its device. Nothing restarts."""
import json
import os
import threading
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import app.api.routers.gpu as gpu_router
import app.config as config
from app.api.dependencies import get_app_settings, get_gpu_pack
from app.api.main import app
from app.services.app_settings import USE_GPU, AppSettings, job_device
from app.services.gpu_pack import GpuInfo, GpuPack
from app.services import pipeline_process
from app.services.pipeline_process import _pipeline_worker
from app.services.transcription_job import make_job_runner

RTX_4060 = GpuInfo(name="NVIDIA GeForce RTX 4060", driver="615.78.08", compute_capability="8.9")
MANIFEST = {
    "platform": "linux-x64", "torch": "2.8.0+cu128", "base_torch": "2.8.0", "cuda": "12.8",
    "min_driver": "570", "min_compute_capability": "7.0", "total_size": 3_920_000_000, "packages": [],
}
JOB = {"id": "j1", "audio_path": "/rec/a.wav", "title": "Sync", "whisper_model": "small", "language": None, "diarize": True}


# ── the setting ───────────────────────────────────────────────────────────────

def test_the_gpu_is_used_on_a_new_installation(tmp_path):
    assert AppSettings(str(tmp_path / "db.sqlite")).get_bool(USE_GPU) is True


def test_turning_the_gpu_off_is_kept(tmp_path):
    db = str(tmp_path / "db.sqlite")
    AppSettings(db).set_bool(USE_GPU, False)
    assert AppSettings(db).get_bool(USE_GPU) is False


def test_reset_turns_the_gpu_back_on(tmp_path):
    settings = AppSettings(str(tmp_path / "db.sqlite"))
    settings.set_bool(USE_GPU, False)
    settings.clear()
    assert settings.get_bool(USE_GPU) is True


@pytest.mark.parametrize("available,use_gpu,expected", [
    ("cuda", True, "cuda"),
    ("cuda", False, "cpu"),
    ("cpu", True, "cpu"),
    ("cpu", False, "cpu"),
])
def test_job_device(tmp_path, monkeypatch, available, use_gpu, expected):
    monkeypatch.setattr(config, "DEVICE", available)
    settings = AppSettings(str(tmp_path / "db.sqlite"))
    settings.set_bool(USE_GPU, use_gpu)
    assert job_device(settings) == expected


# ── a job gets the device of the moment it starts ─────────────────────────────

@pytest.mark.parametrize("in_child", [True, False])
def test_each_job_reads_the_device_when_it_starts(tmp_path, monkeypatch, in_child):
    monkeypatch.setattr(pipeline_process, "RUN_PIPELINE_IN_SUBPROCESS", in_child)
    devices = iter(["cuda", "cpu"])
    run = make_job_runner(storage=MagicMock(), memory_db_path=str(tmp_path / "m.db"), on_saved=lambda: None,
                          device=lambda: next(devices))
    seen = []

    def child(args, on_progress, cancel_event):
        seen.append(args["device"])
        raise RuntimeError("stop here")

    def create_controller(**kw):
        seen.append(kw["device"])
        raise RuntimeError("stop here")

    with patch("app.services.transcription_job.require_job_models"), \
         patch("app.services.transcription_job.run_pipeline_process", side_effect=child), \
         patch("app.services.transcription_job.create_controller", side_effect=create_controller):
        for _ in range(2):
            with pytest.raises(RuntimeError):
                run(JOB, lambda step: None, threading.Event())
    assert seen == ["cuda", "cpu"]


def test_the_queue_asks_the_settings_for_the_device(monkeypatch, tmp_path):
    import app.api.dependencies as deps
    settings = AppSettings(str(tmp_path / "db.sqlite"))
    settings.set_bool(USE_GPU, False)
    monkeypatch.setattr(config, "DEVICE", "cuda")
    captured = {}

    def runner(**kw):
        captured.update(kw)
        return lambda *a: None

    monkeypatch.setattr(deps, "make_job_runner", runner)
    monkeypatch.setattr(deps, "get_app_settings", lambda: settings)
    deps.get_transcription_queue.cache_clear()
    try:
        deps.get_transcription_queue()
    finally:
        deps.get_transcription_queue.cache_clear()
    assert captured["device"]() == "cpu"
    settings.set_bool(USE_GPU, True)
    assert captured["device"]() == "cuda"


# ── the pipeline child ────────────────────────────────────────────────────────

class _Conn:
    def __init__(self):
        self.sent = []

    def send(self, msg):
        self.sent.append(msg)


def _run_child(monkeypatch, device):
    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", "0")   # restored after the test
    seen = {}

    def create_controller(**kw):
        seen["device"] = kw.get("device")
        seen["visible"] = os.environ.get("CUDA_VISIBLE_DEVICES")
        raise RuntimeError("stop here")

    with patch("app.services.service_factory.create_controller", side_effect=create_controller):
        _pipeline_worker({"audio_path": "/a.wav", "whisper_model": "small", "language": None, "diarize": True,
                          "db_path": "/m.db", "device": device}, _Conn())
    return seen


def test_a_cpu_job_hides_the_gpu_from_its_child(monkeypatch):
    assert _run_child(monkeypatch, "cpu") == {"device": "cpu", "visible": ""}


def test_a_gpu_job_keeps_the_gpu(monkeypatch):
    assert _run_child(monkeypatch, "cuda") == {"device": "cuda", "visible": "0"}


# ── the API ───────────────────────────────────────────────────────────────────

@pytest.fixture
def api(tmp_path, monkeypatch):
    """(client, settings, gpu_dir): a working pack, CUDA PyTorch running."""
    manifest_path = tmp_path / "gpu-manifest.json"
    manifest_path.write_text(json.dumps(MANIFEST))
    gpu_dir = tmp_path / "gpu"
    (gpu_dir / "pack" / "torch").mkdir(parents=True)
    (gpu_dir / "pack.json").write_text(json.dumps({"torch": "2.8.0+cu128", "status": "ok"}))
    pack = GpuPack(gpu_dir=gpu_dir, manifest_path=manifest_path, platform="linux", detect=lambda: RTX_4060)
    settings = AppSettings(str(tmp_path / "db.sqlite"))
    app.dependency_overrides[get_gpu_pack] = lambda: pack
    app.dependency_overrides[get_app_settings] = lambda: settings
    monkeypatch.setattr(gpu_router, "_running_torch", lambda: "2.8.0+cu128")
    monkeypatch.setattr(config, "DEVICE", "cuda")
    yield TestClient(app), settings, gpu_dir
    app.dependency_overrides.pop(get_gpu_pack, None)
    app.dependency_overrides.pop(get_app_settings, None)


def test_status_says_the_gpu_is_used(api):
    client, *_ = api
    body = client.get("/gpu").json()
    assert (body["state"], body["cuda_available"], body["use_gpu"], body["device"]) == ("active", True, True, "cuda")


def test_turning_the_gpu_off_keeps_the_pack_active(api):
    client, settings, _ = api
    body = client.put("/gpu/device", json={"use_gpu": False}).json()
    assert (body["state"], body["cuda_available"], body["use_gpu"], body["device"]) == ("active", True, False, "cpu")
    assert settings.get_bool(USE_GPU) is False
    assert client.get("/gpu").json()["device"] == "cpu"


def test_turning_the_gpu_back_on(api):
    client, settings, _ = api
    settings.set_bool(USE_GPU, False)
    body = client.put("/gpu/device", json={"use_gpu": True}).json()
    assert (body["use_gpu"], body["device"]) == (True, "cuda")


def test_without_cuda_the_device_is_the_cpu_whatever_the_choice(api, monkeypatch):
    client, *_ = api
    monkeypatch.setattr(config, "DEVICE", "cpu")
    monkeypatch.setattr(gpu_router, "_running_torch", lambda: "2.8.0+cpu")
    body = client.get("/gpu").json()
    assert (body["cuda_available"], body["use_gpu"], body["device"]) == (False, True, "cpu")
