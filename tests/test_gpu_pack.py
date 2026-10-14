"""GpuPack — the optional CUDA download of the packaged app.

nvidia-smi, the HTTP stream and the pip install are replaced by stand-ins;
nothing here touches the network or a GPU."""
import hashlib
import json
import subprocess
import threading
from asyncio import CancelledError

import pytest

import app.services.gpu_pack as gp
from app.services.gpu_pack import GpuInfo, GpuPack, GpuPackDownloadError, NotEnoughDiskSpace


# ── fixtures ──────────────────────────────────────────────────────────────────

WHEELS = {
    "torch-2.8.0+cu128-cp312-cp312-manylinux_2_28_x86_64.whl": b"torch wheel bytes " * 50,
    "nvidia_cudnn_cu12-9.10.2.21-py3-none-manylinux_2_27_x86_64.whl": b"cudnn" * 30,
}


def _manifest(**overrides):
    packages = [
        {"name": name.split("-")[0], "version": name.split("-")[1],
         "url": f"https://wheels.example/{name}", "sha256": hashlib.sha256(data).hexdigest(),
         "size": len(data)}
        for name, data in WHEELS.items()
    ]
    m = {
        "platform": "linux-x64", "torch": "2.8.0+cu128", "base_torch": "2.8.0", "cuda": "12.8",
        "min_driver": "570", "min_compute_capability": "7.0",
        "total_size": sum(p["size"] for p in packages), "packages": packages,
    }
    m.update(overrides)
    return m


RTX_4060 = GpuInfo(name="NVIDIA GeForce RTX 4060", driver="615.78.08", compute_capability="8.9")


@pytest.fixture
def make_pack(tmp_path):
    """make_pack(manifest=..., gpu=..., platform=...) → GpuPack on tmp_path/gpu."""
    def make(manifest=None, gpu=RTX_4060, platform="linux", packaged=True):
        manifest = _manifest() if manifest is None else manifest
        manifest_path = tmp_path / "gpu-manifest.json"
        manifest_path.write_text(json.dumps(manifest))
        return GpuPack(
            gpu_dir=tmp_path / "gpu" if packaged else None,
            manifest_path=manifest_path if packaged else None,
            platform=platform,
            detect=lambda: gpu,
        )
    return make


@pytest.fixture
def fake_net(monkeypatch):
    """Serves WHEELS by URL; records requests; `fail_after` bytes raises."""
    served = {f"https://wheels.example/{name}": data for name, data in WHEELS.items()}
    calls = []

    def stream(url):
        calls.append(url)
        data = served[url]
        for i in range(0, len(data), 64):
            yield data[i:i + 64]

    monkeypatch.setattr(gp, "_stream", stream)
    return served, calls


@pytest.fixture
def fake_pip(monkeypatch):
    """Instead of pip: unpack each wheel as <dist>/marker into the target."""
    installs = []

    def install(wheels, target, cancel_event):
        installs.append(sorted(w.name for w in wheels))
        target.mkdir(parents=True, exist_ok=True)
        for w in wheels:
            (target / w.name.split("-")[0]).mkdir(exist_ok=True)
            (target / w.name.split("-")[0] / "marker").write_bytes(w.read_bytes())

    monkeypatch.setattr(gp, "_install", install)
    return installs


@pytest.fixture
def plenty_of_disk(monkeypatch):
    monkeypatch.setattr(gp, "_free_bytes", lambda path: 10**12)


# ── nvidia-smi ────────────────────────────────────────────────────────────────

def test_parse_nvidia_smi_takes_the_first_gpu():
    out = "NVIDIA GeForce RTX 4060, 615.78.08, 8.9\nNVIDIA GeForce GTX 1060, 615.78.08, 6.1\n"
    assert gp.parse_nvidia_smi(out) == RTX_4060


@pytest.mark.parametrize("out", ["", "\n", "garbage", "No devices were found\n"])
def test_parse_nvidia_smi_without_a_gpu(out):
    assert gp.parse_nvidia_smi(out) is None


def test_detect_gpu_runs_nvidia_smi_with_a_csv_query():
    seen = {}

    def run(cmd, **kw):
        seen["cmd"] = cmd
        seen["timeout"] = kw.get("timeout")
        return subprocess.CompletedProcess(cmd, 0, stdout="NVIDIA GeForce RTX 4060, 615.78.08, 8.9\n", stderr="")

    assert gp.detect_gpu(run=run, which=lambda name: "/usr/bin/nvidia-smi") == RTX_4060
    assert seen["cmd"][0] == "/usr/bin/nvidia-smi"
    assert "--query-gpu=name,driver_version,compute_cap" in seen["cmd"]
    assert "--format=csv,noheader" in seen["cmd"]
    assert seen["timeout"]


def test_detect_gpu_without_nvidia_smi():
    def run(cmd, **kw):
        raise AssertionError("must not run")
    assert gp.detect_gpu(run=run, which=lambda name: None) is None


@pytest.mark.parametrize("error", [
    subprocess.TimeoutExpired("nvidia-smi", 10),
    OSError("exec format error"),
])
def test_detect_gpu_when_nvidia_smi_fails(error):
    def run(cmd, **kw):
        raise error
    assert gp.detect_gpu(run=run, which=lambda name: "nvidia-smi") is None


def test_detect_gpu_when_nvidia_smi_exits_with_an_error():
    def run(cmd, **kw):
        return subprocess.CompletedProcess(cmd, 9, stdout="", stderr="NVIDIA-SMI has failed")
    assert gp.detect_gpu(run=run, which=lambda name: "nvidia-smi") is None


# ── eligibility ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("platform, packaged, gpu, reason", [
    ("darwin", True, RTX_4060, "unsupported_platform"),
    ("linux", False, RTX_4060, "not_packaged"),
    ("linux", True, None, "no_nvidia"),
    ("linux", True, GpuInfo("NVIDIA GeForce RTX 3060", "535.183.01", "8.6"), "driver_too_old"),
    ("win32", True, GpuInfo("NVIDIA GeForce GTX 1060", "581.29", "6.1"), "gpu_too_old"),
    ("linux", True, GpuInfo("NVIDIA GeForce RTX 3060", "570.86.10", "8.6"), None),
    ("win32", True, GpuInfo("Tesla V100", "572.16", "7.0"), None),
    ("linux", True, RTX_4060, None),
])
def test_blocked_reason(make_pack, platform, packaged, gpu, reason):
    assert make_pack(platform=platform, packaged=packaged, gpu=gpu).blocked_reason() == reason


def test_version_compare_is_numeric():
    assert gp.version_tuple("615.78.08") > gp.version_tuple("570")
    assert gp.version_tuple("10.0") > gp.version_tuple("7.5")
    assert gp.version_tuple("569.99") < gp.version_tuple("570")


def test_gpu_is_detected_once(tmp_path):
    calls = []
    pack = GpuPack(gpu_dir=tmp_path / "gpu", manifest_path=None, platform="linux",
                   detect=lambda: calls.append(1) or RTX_4060)
    pack.gpu()
    pack.gpu()
    assert calls == [1]


# ── pack state ────────────────────────────────────────────────────────────────

def _write_pack(gpu_dir, **pack_json):
    (gpu_dir / "pack" / "torch").mkdir(parents=True)
    (gpu_dir / "pack.json").write_text(json.dumps({"torch": "2.8.0+cu128", "status": "ok", **pack_json}))


def test_state_nothing_installed(make_pack):
    s = make_pack().state(running_torch="2.8.0+cpu", device="cpu")
    assert s == {"state": "not_installed", "pending": None, "error": None}


def test_state_installed_and_running_on_the_gpu(make_pack, tmp_path):
    pack = make_pack()
    _write_pack(tmp_path / "gpu")
    assert pack.state(running_torch="2.8.0+cu128", device="cuda")["state"] == "active"


def test_state_installed_but_not_loaded_waits_for_a_restart(make_pack, tmp_path):
    pack = make_pack()
    _write_pack(tmp_path / "gpu")
    s = pack.state(running_torch="2.8.0+cpu", device="cpu")
    assert s == {"state": "pending_restart", "pending": "install", "error": None}


def test_state_error_from_the_self_check(make_pack, tmp_path):
    pack = make_pack()
    _write_pack(tmp_path / "gpu", status="error", error="CUDA is not available")
    s = pack.state(running_torch="2.8.0+cpu", device="cpu")
    assert s == {"state": "error", "pending": None, "error": "CUDA is not available"}


def test_state_stale_after_torch_changed(make_pack, tmp_path):
    pack = make_pack(manifest=_manifest(torch="2.9.0+cu128", base_torch="2.9.0"))
    _write_pack(tmp_path / "gpu")
    assert pack.state(running_torch="2.9.0+cpu", device="cpu")["state"] == "stale"


def test_state_downloaded_waits_for_a_restart(make_pack, tmp_path):
    pack = make_pack()
    (tmp_path / "gpu" / "incoming" / "pack").mkdir(parents=True)
    (tmp_path / "gpu" / "incoming" / "ready.json").write_text(json.dumps({"torch": "2.8.0+cu128"}))
    s = pack.state(running_torch="2.8.0+cpu", device="cpu")
    assert s == {"state": "pending_restart", "pending": "install", "error": None}


def test_state_removal_waits_for_a_restart(make_pack, tmp_path):
    pack = make_pack()
    _write_pack(tmp_path / "gpu")
    (tmp_path / "gpu" / "remove").touch()
    s = pack.state(running_torch="2.8.0+cu128", device="cuda")
    assert s == {"state": "pending_restart", "pending": "remove", "error": None}


def test_state_incomplete_download_is_not_installed(make_pack, tmp_path):
    pack = make_pack()
    (tmp_path / "gpu" / "incoming" / "wheels").mkdir(parents=True)
    assert pack.state(running_torch="2.8.0+cpu", device="cpu")["state"] == "not_installed"


def test_state_damaged_pack_json_is_an_error(make_pack, tmp_path):
    pack = make_pack()
    (tmp_path / "gpu" / "pack").mkdir(parents=True)
    (tmp_path / "gpu" / "pack.json").write_text("{not json")
    assert pack.state(running_torch="2.8.0+cpu", device="cpu")["state"] == "error"


def test_status_for_the_settings_section(make_pack):
    s = make_pack().status(running_torch="2.8.0+cpu", device="cpu", downloading=False)
    assert s == {
        "blocked_reason": None,
        "gpu": {"name": "NVIDIA GeForce RTX 4060", "driver": "615.78.08", "compute_capability": "8.9"},
        "min_driver": "570",
        "min_compute_capability": "7.0",
        "state": "not_installed",
        "pending": None,
        "error": None,
        "download_size": _manifest()["total_size"],
        "device": "cpu",
        "torch": "2.8.0+cpu",
    }


def test_status_while_downloading(make_pack):
    s = make_pack().status(running_torch="2.8.0+cpu", device="cpu", downloading=True)
    assert s["state"] == "downloading"


def test_status_outside_the_packaged_app(make_pack):
    s = make_pack(packaged=False).status(running_torch="2.8.0+cu128", device="cuda", downloading=False)
    assert s["blocked_reason"] == "not_packaged"
    assert s["state"] == "not_installed"
    assert s["download_size"] is None
    assert s["device"] == "cuda"


# ── download ──────────────────────────────────────────────────────────────────

def test_download_fetches_verifies_and_installs_into_incoming(make_pack, tmp_path, fake_net, fake_pip,
                                                             plenty_of_disk):
    events = []
    pack = make_pack()
    pack.download(cancel_event=threading.Event(), on_progress=events.append)

    gpu = tmp_path / "gpu"
    ready = json.loads((gpu / "incoming" / "ready.json").read_text())
    assert ready["torch"] == "2.8.0+cu128"
    assert (gpu / "incoming" / "pack" / "torch" / "marker").exists()
    assert not (gpu / "incoming" / "wheels").exists(), "wheels removed after the install"
    assert not (gpu / "pack").exists(), "the installed pack is replaced only by the app, before a start"
    assert fake_pip == [sorted(WHEELS)]

    progress = [e for e in events if e["phase"] == "download"]
    assert progress[-1]["pct"] == 100
    assert progress[-1]["downloaded"] == progress[-1]["total"] == _manifest()["total_size"]
    assert [e["pct"] for e in progress] == sorted(e["pct"] for e in progress)
    assert events[-1] == {"type": "progress", "phase": "install"}
    assert pack.state(running_torch="2.8.0+cpu", device="cpu")["pending"] == "install"


def test_download_refuses_a_wheel_with_the_wrong_hash(make_pack, tmp_path, fake_net, fake_pip, plenty_of_disk):
    served, _ = fake_net
    url = next(iter(served))
    served[url] = served[url][:-1] + b"X"
    with pytest.raises(GpuPackDownloadError, match="sha256"):
        make_pack().download(cancel_event=threading.Event(), on_progress=lambda e: None)
    assert not (tmp_path / "gpu" / "incoming").exists()
    assert fake_pip == []


def test_download_refuses_a_wheel_of_the_wrong_size(make_pack, tmp_path, fake_net, fake_pip, plenty_of_disk):
    served, _ = fake_net
    url = next(iter(served))
    served[url] = served[url] + b"more"
    with pytest.raises(GpuPackDownloadError):
        make_pack().download(cancel_event=threading.Event(), on_progress=lambda e: None)
    assert not (tmp_path / "gpu" / "incoming").exists()


def test_cancel_during_the_download_leaves_nothing(make_pack, tmp_path, fake_net, fake_pip, plenty_of_disk):
    cancel = threading.Event()

    def on_progress(event):
        if event.get("downloaded", 0) > 100:
            cancel.set()

    with pytest.raises(CancelledError):
        make_pack().download(cancel_event=cancel, on_progress=on_progress)
    assert not (tmp_path / "gpu" / "incoming").exists()
    assert fake_pip == []


def test_cancel_during_the_install_leaves_nothing(make_pack, tmp_path, fake_net, monkeypatch, plenty_of_disk):
    cancel = threading.Event()

    def install(wheels, target, cancel_event):
        target.mkdir(parents=True)
        (target / "half").touch()
        cancel.set()
        raise CancelledError()

    monkeypatch.setattr(gp, "_install", install)
    with pytest.raises(CancelledError):
        make_pack().download(cancel_event=cancel, on_progress=lambda e: None)
    assert not (tmp_path / "gpu" / "incoming").exists()


def test_a_failed_install_leaves_nothing(make_pack, tmp_path, fake_net, monkeypatch, plenty_of_disk):
    def install(wheels, target, cancel_event):
        raise GpuPackDownloadError("pip install failed: no space")

    monkeypatch.setattr(gp, "_install", install)
    with pytest.raises(GpuPackDownloadError, match="pip install failed"):
        make_pack().download(cancel_event=threading.Event(), on_progress=lambda e: None)
    assert not (tmp_path / "gpu" / "incoming").exists()


def test_a_network_error_leaves_nothing(make_pack, tmp_path, monkeypatch, fake_pip, plenty_of_disk):
    def stream(url):
        yield b"abc"
        raise OSError("connection reset")

    monkeypatch.setattr(gp, "_stream", stream)
    with pytest.raises(OSError, match="connection reset"):
        make_pack().download(cancel_event=threading.Event(), on_progress=lambda e: None)
    assert not (tmp_path / "gpu" / "incoming").exists()


def test_download_needs_room_for_the_wheels_and_the_install(make_pack, tmp_path, fake_net, fake_pip,
                                                           monkeypatch):
    total = _manifest()["total_size"]
    monkeypatch.setattr(gp, "_free_bytes", lambda path: total * gp.DISK_FACTOR - 1)
    with pytest.raises(NotEnoughDiskSpace) as exc:
        make_pack().download(cancel_event=threading.Event(), on_progress=lambda e: None)
    assert exc.value.needed == total * gp.DISK_FACTOR
    _, calls = fake_net
    assert calls == []
    assert not (tmp_path / "gpu" / "incoming").exists()


def test_download_starts_over_from_a_leftover(make_pack, tmp_path, fake_net, fake_pip, plenty_of_disk):
    leftover = tmp_path / "gpu" / "incoming" / "wheels"
    leftover.mkdir(parents=True)
    (leftover / "torch.whl.part").write_bytes(b"half")
    make_pack().download(cancel_event=threading.Event(), on_progress=lambda e: None)
    assert not (tmp_path / "gpu" / "incoming" / "wheels").exists()
    assert (tmp_path / "gpu" / "incoming" / "ready.json").exists()


def test_download_when_blocked_is_refused(make_pack, fake_net, plenty_of_disk):
    with pytest.raises(GpuPackDownloadError, match="driver_too_old"):
        make_pack(gpu=GpuInfo("RTX 3060", "535.1", "8.6")).download(
            cancel_event=threading.Event(), on_progress=lambda e: None)


# ── removal ───────────────────────────────────────────────────────────────────

def test_remove_an_installed_pack_marks_it_for_the_next_start(make_pack, tmp_path):
    pack = make_pack()
    _write_pack(tmp_path / "gpu")
    assert pack.remove() == "restart"
    assert (tmp_path / "gpu" / "remove").exists()
    assert (tmp_path / "gpu" / "pack").exists(), "files in use stay until the app restarts the backend"


def test_remove_a_download_not_yet_applied_drops_it_at_once(make_pack, tmp_path):
    pack = make_pack()
    (tmp_path / "gpu" / "incoming" / "pack").mkdir(parents=True)
    (tmp_path / "gpu" / "incoming" / "ready.json").write_text("{}")
    assert pack.remove() == "removed"
    assert not (tmp_path / "gpu" / "incoming").exists()
    assert not (tmp_path / "gpu" / "remove").exists()
    assert pack.state(running_torch="2.8.0+cpu", device="cpu")["state"] == "not_installed"


def test_remove_a_redownload_over_an_installed_pack_removes_both(make_pack, tmp_path):
    pack = make_pack(manifest=_manifest(torch="2.9.0+cu128"))
    _write_pack(tmp_path / "gpu")  # stale
    (tmp_path / "gpu" / "incoming" / "pack").mkdir(parents=True)
    (tmp_path / "gpu" / "incoming" / "ready.json").write_text("{}")
    assert pack.remove() == "restart"
    assert not (tmp_path / "gpu" / "incoming").exists()
    assert (tmp_path / "gpu" / "remove").exists()


def test_remove_with_nothing_installed(make_pack):
    assert make_pack().remove() is None
