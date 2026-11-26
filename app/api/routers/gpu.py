"""GPU acceleration: status, the optional CUDA download, its removal and the
restart request the app makes before restarting the backend on the change.
See app/services/gpu_pack.py."""
import asyncio
import queue as _queue
import threading
import uuid
from asyncio import CancelledError

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

import app.config as config
from app.api.dependencies import get_app_settings, get_gpu_pack, get_live_recording_service, get_transcription_queue
from app.api.schemas import GpuDeviceChoice, GpuStatus
from app.api.routers import models
from app.logger import get_logger
from app.services.app_settings import USE_GPU, AppSettings, job_device
from app.services.gpu_pack import GpuPack

log = get_logger("gpu")

router = APIRouter(tags=["gpu"])

_HEARTBEAT_INTERVAL = 15  # seconds between heartbeats when no progress arrives

# The one download that may run: {"id", "events": Queue, "cancel": Event}.
_lock = threading.Lock()
_job: dict | None = None
# job_id → its event queue, until the final event is read over the WebSocket
# (a fast download may finish before the client connects).
_events: dict[str, _queue.Queue] = {}


def _running_torch() -> str | None:
    import torch
    version = getattr(torch, "__version__", None)
    return version if isinstance(version, str) else None


def _downloading() -> bool:
    with _lock:
        return _job is not None


def _status(pack: GpuPack, settings: AppSettings) -> dict:
    # The pack's state follows what PyTorch can do (config.DEVICE); a GPU the
    # user turned off still has its pack active.
    status = pack.status(running_torch=_running_torch(), device=config.DEVICE, downloading=_downloading())
    return {**status, "device": job_device(settings), "cuda_available": config.DEVICE == "cuda",
            "use_gpu": settings.get_bool(USE_GPU)}


@router.get("/gpu", response_model=GpuStatus)
def gpu_status(pack: GpuPack = Depends(get_gpu_pack), settings: AppSettings = Depends(get_app_settings)):
    return _status(pack, settings)


@router.put("/gpu/device", response_model=GpuStatus)
def set_gpu_device(body: GpuDeviceChoice, pack: GpuPack = Depends(get_gpu_pack),
                   settings: AppSettings = Depends(get_app_settings)):
    """Use the GPU or not, from the next transcription job on: the running one
    keeps its device, and nothing restarts."""
    settings.set_bool(USE_GPU, body.use_gpu)
    return _status(pack, settings)


@router.post("/gpu/download")
async def start_download(pack: GpuPack = Depends(get_gpu_pack)):
    global _job
    reason = pack.blocked_reason()
    if reason:
        return JSONResponse({"detail": reason}, status_code=409)
    with _lock:
        if _job is not None:
            return JSONResponse({"detail": "already_downloading"}, status_code=409)
        state = pack.state(running_torch=_running_torch(), device=config.DEVICE)["state"]
        if state in ("active", "pending_restart"):
            return JSONResponse({"detail": "installed"}, status_code=409)
        job = {"id": str(uuid.uuid4()), "events": _queue.Queue(), "cancel": threading.Event()}
        _job = job
        _events[job["id"]] = job["events"]

    def run():
        global _job
        log.info("GPU download started")
        try:
            pack.download(cancel_event=job["cancel"], on_progress=job["events"].put)
            final = {"type": "done"}
            log.info("GPU download complete")
        except CancelledError:
            final = {"type": "cancelled"}
            log.info("GPU download cancelled")
        except Exception as exc:
            final = {"type": "error", "message": str(exc)}
            log.error(f"GPU download failed: {exc}")
        # Free the slot before the final event, so a client that reacts to it
        # sees the new state.
        with _lock:
            _job = None
        job["events"].put(final)

    threading.Thread(target=run, name="gpu-download", daemon=True).start()
    return {"job_id": job["id"]}


@router.delete("/gpu/download/{job_id}")
def cancel_download(job_id: str):
    with _lock:
        job = _job if _job is not None and _job["id"] == job_id else None
    if job is None:
        return JSONResponse({"detail": f"No active GPU download '{job_id}'"}, status_code=404)
    job["cancel"].set()
    return {"cancelled": job_id}


@router.websocket("/ws/gpu/{job_id}")
async def ws_download_progress(websocket: WebSocket, job_id: str):
    await websocket.accept()
    events = _events.get(job_id)
    if events is None:
        await websocket.send_json({"type": "error", "message": "Unknown job"})
        await websocket.close()
        return
    try:
        while True:
            try:
                event = await asyncio.to_thread(events.get, timeout=_HEARTBEAT_INTERVAL)
            except _queue.Empty:
                await websocket.send_json({"type": "heartbeat"})
                continue
            await websocket.send_json(event)
            if event["type"] in ("done", "error", "cancelled"):
                _events.pop(job_id, None)
                break
    except WebSocketDisconnect:
        pass


@router.delete("/gpu/pack")
def remove_pack(pack: GpuPack = Depends(get_gpu_pack)):
    if _downloading():
        return JSONResponse({"detail": "Cancel the download first"}, status_code=409)
    result = pack.remove()
    if result is None:
        return JSONResponse({"detail": "No GPU pack installed"}, status_code=404)
    return {"result": result}


@router.post("/gpu/restart")
def request_restart(
    pack: GpuPack = Depends(get_gpu_pack),
    queue=Depends(get_transcription_queue),
    recording=Depends(get_live_recording_service),
):
    """Ready when the app may restart the backend now; otherwise what it waits
    for. A running transcription finishes first and no new one starts."""
    if pack.state(running_torch=_running_torch(), device=config.DEVICE)["state"] != "pending_restart":
        return JSONResponse({"detail": "Nothing to apply"}, status_code=409)
    if recording.is_recording():
        return {"status": "waiting", "reason": "recording"}
    if models.active_downloads():
        return {"status": "waiting", "reason": "model_download"}
    if _downloading():
        return {"status": "waiting", "reason": "gpu_download"}
    if not queue.prepare_restart():
        return {"status": "waiting", "reason": "transcription"}
    return {"status": "ready"}
