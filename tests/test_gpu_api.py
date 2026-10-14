"""/gpu API — status, download with progress over WS, cancel, removal and the
restart request. GpuPack.download is replaced; its own tests are in
test_gpu_pack.py."""
import json
import threading
from asyncio import CancelledError

import pytest
from fastapi.testclient import TestClient

import app.api.routers.gpu as gpu_router
import app.api.routers.models as models_router
import app.config as config
from app.api.dependencies import get_audio_capture_service, get_gpu_pack, get_transcription_queue
from app.api.main import app
from app.services.gpu_pack import GpuInfo, GpuPack, GpuPackDownloadError, NotEnoughDiskSpace

from queue_helpers import Runner, wait_for

RTX_4060 = GpuInfo(name="NVIDIA GeForce RTX 4060", driver="615.78.08", compute_capability="8.9")
MANIFEST = {
    "platform": "linux-x64", "torch": "2.8.0+cu128", "base_torch": "2.8.0", "cuda": "12.8",
    "min_driver": "570", "min_compute_capability": "7.0", "total_size": 3_920_000_000, "packages": [],
}


class StubCapture:
    def __init__(self):
        self.active = False

    def has_active_jobs(self):
        return self.active


@pytest.fixture
def setup(tmp_path, monkeypatch):
    """(client, pack, gpu_dir, capture). GPU detected, CPU torch running."""
    manifest_path = tmp_path / "gpu-manifest.json"
    manifest_path.write_text(json.dumps(MANIFEST))
    gpu_dir = tmp_path / "gpu"
    pack = GpuPack(gpu_dir=gpu_dir, manifest_path=manifest_path, platform="linux", detect=lambda: RTX_4060)
    capture = StubCapture()
    app.dependency_overrides[get_gpu_pack] = lambda: pack
    app.dependency_overrides[get_audio_capture_service] = lambda: capture
    monkeypatch.setattr(gpu_router, "_running_torch", lambda: "2.8.0+cpu")
    monkeypatch.setattr(config, "DEVICE", "cpu")
    yield TestClient(app), pack, gpu_dir, capture
    app.dependency_overrides.pop(get_gpu_pack, None)
    app.dependency_overrides.pop(get_audio_capture_service, None)


def _fake_download(monkeypatch, gate=None, outcome=None):
    """GpuPack.download stand-in: two progress events, waits for `gate`
    (or cancel), then writes ready.json or raises `outcome`."""
    def download(self, cancel_event, on_progress):
        on_progress({"type": "progress", "phase": "download", "pct": 50, "downloaded": 1, "total": 2})
        while gate is not None and not gate.is_set():
            if cancel_event.wait(0.01):
                break
        if cancel_event.is_set():
            raise CancelledError()
        if outcome is not None:
            raise outcome
        on_progress({"type": "progress", "phase": "install"})
        incoming = self._gpu_dir / "incoming"
        (incoming / "pack").mkdir(parents=True)
        (incoming / "ready.json").write_text(json.dumps({"torch": "2.8.0+cu128"}))

    monkeypatch.setattr(GpuPack, "download", download)


def _events(client, job_id):
    out = []
    with client.websocket_connect(f"/ws/gpu/{job_id}") as ws:
        while True:
            event = ws.receive_json()
            out.append(event)
            if event["type"] in ("done", "error", "cancelled"):
                return out


def _install_pack(gpu_dir, **extra):
    (gpu_dir / "pack" / "torch").mkdir(parents=True)
    (gpu_dir / "pack.json").write_text(json.dumps({"torch": "2.8.0+cu128", "status": "ok", **extra}))


# ── GET /gpu ──────────────────────────────────────────────────────────────────

def test_status(setup):
    client, *_ = setup
    body = client.get("/gpu").json()
    assert body["blocked_reason"] is None
    assert body["gpu"]["name"] == "NVIDIA GeForce RTX 4060"
    assert body["state"] == "not_installed"
    assert body["download_size"] == 3_920_000_000
    assert body["device"] == "cpu"
    assert body["torch"] == "2.8.0+cpu"


def test_status_outside_the_packaged_app(monkeypatch):
    app.dependency_overrides[get_gpu_pack] = lambda: GpuPack(
        gpu_dir=None, manifest_path=None, platform="linux", detect=lambda: RTX_4060)
    try:
        body = TestClient(app).get("/gpu").json()
    finally:
        app.dependency_overrides.pop(get_gpu_pack, None)
    assert body["blocked_reason"] == "not_packaged"


# ── download ──────────────────────────────────────────────────────────────────

def test_download_reports_progress_then_waits_for_a_restart(setup, monkeypatch):
    client, *_ = setup
    _fake_download(monkeypatch)
    job_id = client.post("/gpu/download").json()["job_id"]
    events = _events(client, job_id)
    assert [e["type"] for e in events] == ["progress", "progress", "done"]
    assert events[0]["pct"] == 50
    wait_for(lambda: client.get("/gpu").json()["state"] == "pending_restart")
    assert client.get("/gpu").json()["pending"] == "install"


def test_status_while_downloading_and_a_second_download_is_refused(setup, monkeypatch):
    client, *_ = setup
    gate = threading.Event()
    _fake_download(monkeypatch, gate=gate)
    job_id = client.post("/gpu/download").json()["job_id"]
    try:
        assert client.get("/gpu").json()["state"] == "downloading"
        r = client.post("/gpu/download")
        assert r.status_code == 409
        assert r.json()["detail"] == "already_downloading"
    finally:
        gate.set()
    assert _events(client, job_id)[-1]["type"] == "done"


def test_cancel_a_download(setup, monkeypatch):
    client, *_ = setup
    _fake_download(monkeypatch, gate=threading.Event())
    job_id = client.post("/gpu/download").json()["job_id"]
    assert client.delete(f"/gpu/download/{job_id}").json() == {"cancelled": job_id}
    assert _events(client, job_id)[-1]["type"] == "cancelled"
    wait_for(lambda: client.get("/gpu").json()["state"] == "not_installed")


def test_cancel_an_unknown_download(setup):
    client, *_ = setup
    assert client.delete("/gpu/download/nope").status_code == 404


@pytest.mark.parametrize("error, message", [
    (GpuPackDownloadError("sha256 mismatch for torch"), "sha256 mismatch for torch"),
    (NotEnoughDiskSpace(needed=12_000_000_000, free=5_000_000_000),
     "Not enough disk space: 12.0 GB needed, 5.0 GB free"),
    (OSError("connection reset"), "connection reset"),
])
def test_a_failed_download_reports_the_reason(setup, monkeypatch, error, message):
    client, *_ = setup
    _fake_download(monkeypatch, outcome=error)
    job_id = client.post("/gpu/download").json()["job_id"]
    last = _events(client, job_id)[-1]
    assert last == {"type": "error", "message": message}
    wait_for(lambda: client.get("/gpu").json()["state"] == "not_installed")


def test_download_refused_when_the_gpu_does_not_qualify(setup, monkeypatch):
    client, pack, *_ = setup
    pack._gpu = GpuInfo("NVIDIA GeForce GTX 1060", "581.29", "6.1")
    pack._detected = True
    r = client.post("/gpu/download")
    assert r.status_code == 409
    assert r.json()["detail"] == "gpu_too_old"


@pytest.mark.parametrize("prepare", ["active", "pending_install", "pending_remove"])
def test_download_refused_while_installed_or_pending(setup, monkeypatch, prepare):
    client, _, gpu_dir, _ = setup
    _install_pack(gpu_dir)
    if prepare == "active":
        monkeypatch.setattr(gpu_router, "_running_torch", lambda: "2.8.0+cu128")
        monkeypatch.setattr(config, "DEVICE", "cuda")
    elif prepare == "pending_remove":
        (gpu_dir / "remove").touch()
    r = client.post("/gpu/download")
    assert r.status_code == 409
    assert r.json()["detail"] == "installed"


@pytest.mark.parametrize("pack_json", [{"status": "error", "error": "CUDA is not available"},
                                       {"torch": "2.7.1+cu128"}])
def test_download_again_after_an_error_or_a_torch_change(setup, monkeypatch, pack_json):
    client, _, gpu_dir, _ = setup
    _install_pack(gpu_dir, **pack_json)
    _fake_download(monkeypatch)
    r = client.post("/gpu/download")
    assert r.status_code == 200
    assert _events(client, r.json()["job_id"])[-1]["type"] == "done"


# ── DELETE /gpu/pack ──────────────────────────────────────────────────────────

def test_remove_an_installed_pack_waits_for_a_restart(setup):
    client, _, gpu_dir, _ = setup
    _install_pack(gpu_dir)
    assert client.delete("/gpu/pack").json() == {"result": "restart"}
    body = client.get("/gpu").json()
    assert (body["state"], body["pending"]) == ("pending_restart", "remove")


def test_remove_a_download_not_yet_applied(setup, monkeypatch):
    client, *_ = setup
    _fake_download(monkeypatch)
    _events(client, client.post("/gpu/download").json()["job_id"])
    assert client.delete("/gpu/pack").json() == {"result": "removed"}
    assert client.get("/gpu").json()["state"] == "not_installed"


def test_remove_with_nothing_installed(setup):
    client, *_ = setup
    assert client.delete("/gpu/pack").status_code == 404


def test_remove_while_downloading_is_refused(setup, monkeypatch):
    client, *_ = setup
    gate = threading.Event()
    _fake_download(monkeypatch, gate=gate)
    job_id = client.post("/gpu/download").json()["job_id"]
    try:
        assert client.delete("/gpu/pack").status_code == 409
    finally:
        gate.set()
    _events(client, job_id)


# ── POST /gpu/restart ─────────────────────────────────────────────────────────

def test_restart_with_nothing_to_apply_is_refused(setup):
    client, *_ = setup
    assert client.post("/gpu/restart").status_code == 409


def test_restart_is_ready_when_nothing_runs_and_holds_the_queue(setup, tmp_path):
    client, _, gpu_dir, _ = setup
    _install_pack(gpu_dir)
    (gpu_dir / "remove").touch()
    calls = []
    queue = app.dependency_overrides[get_transcription_queue]()
    queue.prepare_restart = lambda: calls.append(1) or True
    assert client.post("/gpu/restart").json() == {"status": "ready"}
    assert calls == [1]


def test_restart_waits_for_a_recording(setup):
    client, _, gpu_dir, capture = setup
    _install_pack(gpu_dir)
    (gpu_dir / "remove").touch()
    capture.active = True
    assert client.post("/gpu/restart").json() == {"status": "waiting", "reason": "recording"}


def test_restart_waits_for_a_model_download(setup, monkeypatch):
    client, _, gpu_dir, _ = setup
    _install_pack(gpu_dir)
    (gpu_dir / "remove").touch()
    monkeypatch.setattr(models_router, "active_downloads", lambda: True)
    assert client.post("/gpu/restart").json() == {"status": "waiting", "reason": "model_download"}


def test_restart_waits_for_the_running_transcription(setup, tmp_path):
    client, _, gpu_dir, _ = setup
    _install_pack(gpu_dir)
    (gpu_dir / "remove").touch()

    from app.services.job_store import JobStore
    from app.services.transcription_queue import TranscriptionQueue
    runner = Runner()
    runner.hold("a")
    recordings = tmp_path / "recordings"
    recordings.mkdir()
    queue = TranscriptionQueue(JobStore(db_path=str(tmp_path / "jobs.db")), runner, recordings_dir=recordings)
    audio = recordings / "sonorus-import-a.wav"
    audio.write_bytes(b"x")
    queue.add(audio_path=str(audio), title="a", whisper_model="small", language=None)
    queue.start()
    queue.start_worker()
    app.dependency_overrides[get_transcription_queue] = lambda: queue
    try:
        wait_for(lambda: runner.started == ["a"])
        assert client.post("/gpu/restart").json() == {"status": "waiting", "reason": "transcription"}
        runner.release("a")
        wait_for(lambda: not queue.is_running())
        assert client.post("/gpu/restart").json() == {"status": "ready"}
    finally:
        queue.stop_worker()


def test_models_router_reports_active_downloads(monkeypatch):
    assert models_router.active_downloads() is False
    monkeypatch.setitem(models_router._cancel_events, "job", threading.Event())
    assert models_router.active_downloads() is True
