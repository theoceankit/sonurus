---
sidebar_position: 11
---

# GPU Pack

`app/services/gpu_pack.py` (`GpuPack`) handles the optional GPU acceleration of the packaged app on Linux and Windows: the CUDA build of PyTorch, downloaded inside the app on top of the CPU-only libraries the installer ships. The API is described in [API Endpoints → GPU acceleration](../api/endpoints.md#gpu-acceleration); how the manifest is built in [Packaging → GPU manifests](../distribution/packaging.md#gpu-manifests).

---

## Who does what

| Part | Responsibility |
|---|---|
| Build (`scripts/lock-backend.js`, `scripts/bundle-backend.js`) | `backend-dist/gpu-manifest.json`: the wheels to download, with URL, sha256 and size |
| Backend (`GpuPack`, `/gpu`) | Detects the GPU, downloads and verifies the wheels, installs them into `incoming/`, marks a removal, tells the app when it may restart the backend |
| Electron (the backend's owner) | Before every backend start: applies a finished download or a removal, runs the self-check (`python -m app.gpu_probe`), starts the backend with or without the pack on `PYTHONPATH` — see [GPU acceleration](../ui/electron/gpu-acceleration.md) |

The backend never replaces or deletes files of the installed pack: they are loaded into its own process (on Windows the DLLs cannot be deleted while it runs).

---

## Configuration

Electron sets two variables when it starts the packaged backend on Linux or Windows; without them (development, macOS) no download is offered and `GET /gpu` reports `blocked_reason: "not_packaged"` (or `"unsupported_platform"` on macOS).

| Variable | `app/config.py` | Value |
|---|---|---|
| `SONORUS_GPU_DIR` | `GPU_DIR` | `<userData>/gpu` |
| `SONORUS_GPU_MANIFEST` | `GPU_MANIFEST` | `<resources>/backend/gpu-manifest.json` |

---

## Files under `GPU_DIR`

| Path | Written by | Meaning |
|---|---|---|
| `pack/` | app | The installed pack (`pip --target` layout); on `PYTHONPATH` before the bundled libraries when valid |
| `pack.json` | app | `{torch, status: "ok" \| "error", error, …}` — result of the self-check |
| `incoming/wheels/` | backend | Wheels being downloaded (`*.part` until verified) |
| `incoming/pack/` | backend | The download, installed with pip |
| `incoming/ready.json` | backend | `{torch, installed_at}` — the download is complete |
| `remove` | backend | The user removed the pack; the app deletes `pack/` before the next start |

`POST /data/reset` does not touch this folder (like downloaded models).

---

## GPU check — `detect_gpu()`, `blocked_reason()`

`nvidia-smi --query-gpu=name,driver_version,compute_cap --format=csv,noheader` (10 s timeout); the first GPU counts. No `nvidia-smi`, a failure or no GPU → no NVIDIA GPU. The result is kept for the life of the `GpuPack` (the API singleton).

`blocked_reason()` — why no download is offered, in this order:

| Reason | When |
|---|---|
| `unsupported_platform` | macOS |
| `not_packaged` | `GPU_DIR` or the manifest missing |
| `no_nvidia` | `nvidia-smi` found no GPU |
| `driver_too_old` | driver below the manifest's `min_driver` (570, CUDA 12.8) |
| `gpu_too_old` | compute capability below `min_compute_capability` (7.0) |

Versions compare numerically (`615.78.08` > `570`).

---

## State — `state(running_torch, device)`

| `state` | `pending` | When |
|---|---|---|
| `not_installed` | — | Nothing installed or downloaded (an unfinished `incoming/` counts as nothing) |
| `pending_restart` | `remove` | `remove` marker present |
| `pending_restart` | `install` | `incoming/ready.json` present, or a valid pack the running backend has not loaded |
| `error` | — | `pack.json` says `error` (self-check failed) or is unreadable |
| `stale` | — | `pack.json` names another `torch` than the manifest (the app update changed PyTorch) |
| `active` | — | The running backend uses the manifest's `torch` on `cuda` |

`status()` adds the GPU, the minimums, `download_size` (`total_size` of the manifest), the running `device` and `torch`; while a download runs `state` is `downloading`.

---

## Download — `download(cancel_event, on_progress)`

1. Refused (`GpuPackDownloadError` with the reason) if `blocked_reason()` is set; a leftover `incoming/` is removed.
2. Free space must be at least `DISK_FACTOR` (3) × `total_size` — the wheels plus the install next to them — else `NotEnoughDiskSpace` ("Not enough disk space: 11.8 GB needed, 5.0 GB free").
3. Every wheel is streamed (`httpx`, redirects followed) into `incoming/wheels/<name>.part`, hashed on the way, checked against the manifest's size and sha256, then renamed. Progress: `{type: "progress", phase: "download", pct, downloaded, total}` over all wheels.
4. `{type: "progress", phase: "install"}`, then `python -m pip install --no-deps --no-index --no-compile --target incoming/pack <wheels>` with the backend's own interpreter.
5. The wheels are deleted and `incoming/ready.json` written.

Cancel is checked between chunks and stops pip (`terminate`) → `CancelledError`. Any failure or cancel removes `incoming/` completely. The download runs in a thread of the backend, not in a child process: unlike `snapshot_download`, the loop can stop between chunks.

---

## Removal — `remove()`

| Situation | Result |
|---|---|
| A download not yet applied (`incoming/ready.json`) and no installed pack | `incoming/` deleted → `"removed"`, no restart needed |
| An installed pack (with or without a download on top) | `incoming/` deleted, `remove` marker written → `"restart"` |
| Nothing | `None` (API: `404`) |

---

## Self-check — `app/gpu_probe.py`

Run by the app with the pack on `PYTHONPATH` before it starts the backend on a new pack. Prints one JSON line `{ok, torch, device, error}` and exits `0` / `1`:

1. `torch.cuda.is_available()` — else "CUDA is not available to PyTorch";
2. `(torch.ones(8, device="cuda") * 2).sum()` equals 16 (kernels exist for this GPU);
3. `ctranslate2.get_cuda_device_count() > 0` — faster-whisper sees the GPU (on Windows it relies on the CUDA DLLs `torch` loaded).

An exception (e.g. a missing CUDA library) is reported as `"<Type>: <message>"`.

---

## Restart

After a download or a removal the backend has to restart. `POST /gpu/restart` answers `ready` only when no transcription runs, no capture runs and no model or GPU download runs; otherwise `waiting` with the reason. A running transcription is not interrupted: `TranscriptionQueue.prepare_restart()` keeps the worker from starting the next job and remembers whether the queue was running, so the restarted backend continues ([Transcription Queue → Worker](./TranscriptionQueue.md#worker)).
