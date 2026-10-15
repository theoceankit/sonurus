---
sidebar_position: 4
---

# GPU Acceleration

The installers ship CPU-only PyTorch. On Linux and Windows the installed app can download the CUDA build of PyTorch (≈ 3.9 GB on Linux, ≈ 3.5 GB on Windows; ≈ 6.3 GB on disk once installed) and transcribe on an NVIDIA GPU. macOS has no CUDA and shows no GPU section. The backend side (GPU check, download, states, files) is in [GPU Pack](../../services/GpuPack.md); the manifest of what is downloaded in [Packaging → GPU manifests](../../distribution/packaging.md#gpu-manifests).

---

## Settings → GPU acceleration

The section follows `GET /gpu` and the app-level state of `gpu-acceleration.js`; `gpuSectionView()` turns both into a label, a detail line, the device the backend runs on ("Running on CPU" / "Running on GPU") and the actions:

| Situation | Label | Actions |
|---|---|---|
| Development build (`npm start`, no manifest) | Development build | — (the PyTorch of `.venv` decides) |
| No NVIDIA GPU / driver below 570 / compute capability below 7.0 | No NVIDIA GPU found / Driver update needed / GPU not supported, with the GPU, driver and minimum | — |
| Nothing installed | Not installed | **Download (3.9 GB)** |
| Downloading / installing | Downloading (progress bar) / Installing | **Cancel** |
| Waiting for the restart | Waiting to apply / Removing, with what it waits for | — |
| Restarting the backend | Restarting | — |
| Running on the GPU | On | **Remove** |
| The self-check failed | GPU check failed, with its message | **Download again**, **Remove** |
| An app update changed PyTorch | Update needed | **Download update**, **Remove** |

An installed pack can always be removed, also when the GPU no longer qualifies (e.g. after a driver downgrade). No other screen offers the download.

Like model downloads, the download and a pending restart belong to the app, not to the Settings page: leaving Settings keeps them going (`subscribeGpu()` / the card's `_cleanup` only stop listening). A failed download shows a toast with the reason (e.g. "GPU download failed: Not enough disk space: 11.8 GB needed, 5.0 GB free").

---

## Applying a download or a removal

The backend never replaces files it has loaded (on Windows the DLLs cannot even be deleted while it runs). A download ends in `<userData>/gpu/incoming/`, a removal as the marker `<userData>/gpu/remove`; the backend restart applies them:

1. `gpu-acceleration.js` asks `POST /gpu/restart` right away and then every 3 s while the answer is `waiting` — a running transcription (it finishes; no other job starts, and the queue continues after the restart), a recording or a model download. The section names what it waits for.
2. On `ready` it calls `electronAPI.restartBackend()`. The main process stops the backend, waits until port 8000 is free and starts it again (`restartBackend()` in `electron/backend.js`). A backend the app did not start but reused because it serves the app's data directory (it outlived a crash) is stopped by the `pid` from `GET /health`. If the port is still taken after that, the restart fails (toast) instead of reconnecting to the old backend, which would silently not apply the change.
3. Before every start `prepareGpuStart()` (`electron/gpu-pack.js`) applies the change: `incoming/pack` replaces `pack/` (recorded in `pack.json` as `unchecked`), a removal deletes `pack/` and `pack.json`, an unfinished download is cleared.
4. A new pack, or one the current app version has not checked yet, runs the self-check `python -m app.gpu_probe` with the pack on `PYTHONPATH` (2-minute timeout). `pack.json` records `ok` or `error` with the message and the app version.
5. The backend starts with `SONORUS_GPU_DIR` and `SONORUS_GPU_MANIFEST`, and with `PYTHONPATH=<userData>/gpu/pack` only for a checked pack whose `torch` matches the manifest. If it does not come up with the pack, the pack is marked `error` ("The backend did not start with GPU acceleration: …") and the backend starts again on the CPU.
6. The renderer reads `GET /gpu` again and shows a toast: "GPU acceleration is on", "GPU check failed: … Transcription runs on the CPU." or "GPU acceleration removed. Transcription runs on the CPU." The queue's WebSocket reconnects by itself.

A pack recorded as `error` or for another PyTorch (`stale`, after an app update) is never put on `PYTHONPATH`: the app keeps working on the CPU until the user downloads again or removes it.

---

## Key files

| File | Role |
|---|---|
| `electron/renderer/gpu-acceleration.js` | `gpuState()` / `subscribeGpu()`, `refreshGpuStatus()`, `startGpuDownload()` / `cancelGpuDownload()`, `removeGpuPack()`, the restart loop, `gpuSectionView()` |
| `electron/renderer/views/settings-view.js` | `buildGpuSection()` |
| `electron/gpu-pack.js` | `gpuSupported()`, `applyPendingOps()`, `prepareGpuStart()`, `runProbe()`, `markPackError()`, `gpuBackendEnv()` |
| `electron/backend.js` | Uses the above before every start; `restartBackend()` |
| `app/gpu_probe.py` | The self-check |
