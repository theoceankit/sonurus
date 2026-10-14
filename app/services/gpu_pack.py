"""GPU acceleration for the packaged app: an optional download of the CUDA
build of PyTorch (Linux, Windows).

The installers ship CPU-only libraries. The build ships a manifest
(locks/gpu-<platform>.json → backend-dist/gpu-manifest.json) listing the
wheels that turn them into a CUDA setup. This service checks the GPU
(nvidia-smi), downloads and verifies those wheels and installs them with pip
into <gpu_dir>/incoming/pack. The Electron app, which owns the backend
process, moves a finished download into <gpu_dir>/pack before the next start,
checks it (app/gpu_probe.py) and puts it in front of the bundled libraries on
PYTHONPATH. Files under <gpu_dir>:

  pack/              the installed pack (written by the app)
  pack.json          {torch, status: ok|error, error, …} (written by the app)
  incoming/          a download in progress or finished (written here)
  incoming/ready.json  the download is complete and installed
  remove             the user removed the pack; the app deletes it before a start
"""
import hashlib
import json
import shutil
import subprocess
import sys
import time
from asyncio import CancelledError
from pathlib import Path
from typing import NamedTuple
from urllib.parse import unquote

from app.logger import get_logger

log = get_logger("GpuPack")

# Free space a download needs: the wheels plus the unpacked install next to them.
DISK_FACTOR = 3

_CHUNK = 1 << 20


class GpuInfo(NamedTuple):
    name: str
    driver: str
    compute_capability: str


class GpuPackDownloadError(Exception):
    pass


class NotEnoughDiskSpace(GpuPackDownloadError):
    def __init__(self, needed: int, free: int):
        self.needed = needed
        self.free = free
        super().__init__(f"Not enough disk space: {needed / 1e9:.1f} GB needed, {free / 1e9:.1f} GB free")


# ── nvidia-smi ────────────────────────────────────────────────────────────────

def parse_nvidia_smi(output: str) -> GpuInfo | None:
    """First GPU from `nvidia-smi --query-gpu=name,driver_version,compute_cap --format=csv,noheader`."""
    for line in output.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) == 3 and all(parts):
            try:
                version_tuple(parts[1])
                version_tuple(parts[2])
            except ValueError:
                continue
            return GpuInfo(*parts)
    return None


def detect_gpu(run=subprocess.run, which=shutil.which) -> GpuInfo | None:
    """The NVIDIA GPU, or None (no NVIDIA driver, no GPU, nvidia-smi failing)."""
    exe = which("nvidia-smi")
    if exe is None:
        return None
    cmd = [exe, "--query-gpu=name,driver_version,compute_cap", "--format=csv,noheader"]
    try:
        res = run(cmd, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError) as exc:
        log.info(f"nvidia-smi failed: {exc}")
        return None
    if res.returncode != 0:
        log.info(f"nvidia-smi exited with {res.returncode}: {res.stderr.strip()}")
        return None
    return parse_nvidia_smi(res.stdout)


def version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


# ── download helpers (replaced in tests) ──────────────────────────────────────

def _stream(url: str):
    """Yield the bytes of url."""
    import httpx
    timeout = httpx.Timeout(30.0, read=60.0)
    with httpx.stream("GET", url, follow_redirects=True, timeout=timeout) as res:
        res.raise_for_status()
        yield from res.iter_bytes(_CHUNK)


def _install(wheels: list[Path], target: Path, cancel_event) -> None:
    """pip-install the downloaded wheels (no index, no dependencies) into target."""
    cmd = [sys.executable, "-m", "pip", "install", "--no-deps", "--no-index", "--no-compile",
           "--disable-pip-version-check", "--no-warn-script-location", "--target", str(target),
           *map(str, wheels)]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    while proc.poll() is None:
        if cancel_event.wait(0.2):
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            raise CancelledError()
    stderr = proc.stderr.read() if proc.stderr else ""
    if proc.returncode != 0:
        tail = "\n".join(stderr.strip().splitlines()[-5:])
        raise GpuPackDownloadError(f"pip install failed (exit {proc.returncode}): {tail}")


def _free_bytes(path: Path) -> int:
    path.mkdir(parents=True, exist_ok=True)
    return shutil.disk_usage(path).free


# ── GpuPack ───────────────────────────────────────────────────────────────────

class GpuPack:
    def __init__(self, gpu_dir: Path | None, manifest_path: Path | None,
                 platform: str = sys.platform, detect=detect_gpu):
        self._gpu_dir = Path(gpu_dir) if gpu_dir else None
        self._platform = platform
        self._detect = detect
        self._gpu: GpuInfo | None = None
        self._detected = False
        self.manifest: dict | None = None
        if manifest_path and Path(manifest_path).is_file():
            self.manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))

    # ── checks ──────────────────────────────────────────────────────────────

    def gpu(self) -> GpuInfo | None:
        if not self._detected:
            self._gpu = self._detect()
            self._detected = True
        return self._gpu

    def blocked_reason(self) -> str | None:
        """Why no download is offered, or None."""
        if self._platform == "darwin":
            return "unsupported_platform"
        if self._gpu_dir is None or self.manifest is None:
            return "not_packaged"
        gpu = self.gpu()
        if gpu is None:
            return "no_nvidia"
        if version_tuple(gpu.driver) < version_tuple(self.manifest["min_driver"]):
            return "driver_too_old"
        if version_tuple(gpu.compute_capability) < version_tuple(self.manifest["min_compute_capability"]):
            return "gpu_too_old"
        return None

    # ── state ───────────────────────────────────────────────────────────────

    def _path(self, name: str) -> Path:
        return self._gpu_dir / name

    def _read_pack_json(self) -> dict | None:
        try:
            return json.loads(self._path("pack.json").read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as exc:
            return {"status": "error", "error": f"Unreadable pack.json: {exc}"}

    def state(self, running_torch: str | None, device: str) -> dict:
        """{state, pending, error}: not_installed | pending_restart (pending:
        install | remove) | active | error | stale."""
        def out(state, pending=None, error=None):
            return {"state": state, "pending": pending, "error": error}

        if self._gpu_dir is None:
            return out("not_installed")
        if self._path("remove").exists():
            return out("pending_restart", "remove")
        if (self._path("incoming") / "ready.json").exists():
            return out("pending_restart", "install")
        info = self._read_pack_json()
        if info is None or not self._path("pack").is_dir():
            return out("not_installed")
        if info.get("status") == "error":
            return out("error", error=info.get("error") or "GPU check failed")
        if self.manifest is None or info.get("torch") != self.manifest["torch"]:
            return out("stale")
        if running_torch == self.manifest["torch"] and device == "cuda":
            return out("active")
        return out("pending_restart", "install")

    def status(self, running_torch: str | None, device: str, downloading: bool) -> dict:
        gpu = self.gpu() if self._platform != "darwin" else None
        state = self.state(running_torch, device)
        if downloading:
            state = {"state": "downloading", "pending": None, "error": None}
        m = self.manifest if self._gpu_dir is not None else None
        return {
            "blocked_reason": self.blocked_reason(),
            "gpu": gpu._asdict() if gpu else None,
            "min_driver": m["min_driver"] if m else None,
            "min_compute_capability": m["min_compute_capability"] if m else None,
            **state,
            "download_size": m["total_size"] if m else None,
            "device": device,
            "torch": running_torch,
        }

    # ── download ────────────────────────────────────────────────────────────

    def download(self, cancel_event, on_progress) -> None:
        """Download, verify and install the pack into incoming/. Raises
        CancelledError, NotEnoughDiskSpace, GpuPackDownloadError or the
        network error; nothing is left in incoming/ then."""
        reason = self.blocked_reason()
        if reason:
            raise GpuPackDownloadError(reason)
        incoming = self._path("incoming")
        shutil.rmtree(incoming, ignore_errors=True)
        try:
            self._download(incoming, cancel_event, on_progress)
        except BaseException:
            shutil.rmtree(incoming, ignore_errors=True)
            raise

    def _download(self, incoming: Path, cancel_event, on_progress) -> None:
        packages = self.manifest["packages"]
        total = self.manifest["total_size"]
        needed = total * DISK_FACTOR
        free = _free_bytes(self._gpu_dir)
        if free < needed:
            raise NotEnoughDiskSpace(needed=needed, free=free)

        wheels_dir = incoming / "wheels"
        wheels_dir.mkdir(parents=True)
        done = 0
        last_pct = -1
        wheels = []
        for pkg in packages:
            wheel = wheels_dir / unquote(pkg["url"].rsplit("/", 1)[-1])
            part = wheel.with_name(wheel.name + ".part")
            sha = hashlib.sha256()
            size = 0
            with open(part, "wb") as f:
                for chunk in _stream(pkg["url"]):
                    if cancel_event.is_set():
                        raise CancelledError()
                    f.write(chunk)
                    sha.update(chunk)
                    size += len(chunk)
                    pct = min(100, (done + size) * 100 // total) if total else 100
                    if pct != last_pct:
                        last_pct = pct
                        on_progress({"type": "progress", "phase": "download", "pct": pct,
                                     "downloaded": done + size, "total": total})
                    if cancel_event.is_set():
                        raise CancelledError()
            if size != pkg["size"]:
                raise GpuPackDownloadError(f"{pkg['name']}: got {size} bytes, expected {pkg['size']}")
            if sha.hexdigest() != pkg["sha256"]:
                raise GpuPackDownloadError(f"{pkg['name']}: sha256 does not match the manifest")
            part.rename(wheel)
            wheels.append(wheel)
            done += size

        if last_pct != 100:
            on_progress({"type": "progress", "phase": "download", "pct": 100,
                         "downloaded": done, "total": total})
        on_progress({"type": "progress", "phase": "install"})
        _install(wheels, incoming / "pack", cancel_event)
        if cancel_event.is_set():
            raise CancelledError()
        shutil.rmtree(wheels_dir)
        (incoming / "ready.json").write_text(
            json.dumps({"torch": self.manifest["torch"], "installed_at": time.time()}), encoding="utf-8")
        log.info(f"GPU pack {self.manifest['torch']} downloaded; applied at the next backend start")

    # ── removal ─────────────────────────────────────────────────────────────

    def remove(self) -> str | None:
        """Drop a download not yet applied ("removed"), mark an installed pack
        for removal at the next start ("restart"), or None if there is nothing."""
        if self._gpu_dir is None:
            return None
        incoming = self._path("incoming")
        had_download = (incoming / "ready.json").exists()
        if had_download:
            shutil.rmtree(incoming, ignore_errors=True)
        if self._path("pack").is_dir():
            self._path("remove").touch()
            return "restart"
        return "removed" if had_download else None
