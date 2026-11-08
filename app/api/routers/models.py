import asyncio
import threading
import uuid
from collections import deque
from asyncio import CancelledError
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

import app.config as config
from app.api.dependencies import get_transcription_queue
from app.api.schemas import DownloadRequest, ModelInfo
from app.services.model_service import ModelDownloadError, ModelService, WHISPER_CATALOG, DIARIZATION_CATALOG, ALIGNMENT_CATALOG
from app.logger import get_logger

log = get_logger("models")

router = APIRouter(tags=["models"])

_executor = ThreadPoolExecutor(max_workers=2)

_HEARTBEAT_INTERVAL = 15  # seconds between heartbeats when no progress arrives



class _DownloadEvents:
    """The events of one download, for any number of WebSockets. Each reads from its
    own position, so a connection that drops loses nothing for the next one; a new
    connection starts at the latest event, which after the end is how it ended."""

    def __init__(self):
        self._events: list[dict] = []
        self._changed = threading.Condition()

    def put(self, event: dict) -> None:
        with self._changed:
            self._events.append(event)
            self._changed.notify_all()

    def latest(self) -> int:
        with self._changed:
            return max(len(self._events) - 1, 0)

    def get(self, index: int, timeout: float) -> dict | None:
        """The event at index, waiting up to timeout for it; None if it did not come."""
        with self._changed:
            self._changed.wait_for(lambda: len(self._events) > index, timeout)
            return self._events[index] if len(self._events) > index else None


# job_id → its events. A finished download stays for the last _FINISHED_KEPT, so a
# connection after a fast end still gets how it ended.
_download_jobs: dict[str, _DownloadEvents] = {}
_FINISHED_KEPT = 16
_finished_jobs: deque[str] = deque()
# job_id → threading.Event for cancellation
_cancel_events: dict[str, threading.Event] = {}
# model_id → job_id of its running download: one download per model, since two
# would write into the same cache (e.g. two queued jobs failing on one missing
# alignment model). A second POST joins the running one.
_running_downloads: dict[str, str] = {}
_running_lock = threading.Lock()


def active_downloads() -> bool:
    """A model download is running (the backend must not restart now)."""
    return bool(_cancel_events)


def shutdown_executor():
    _executor.shutdown(wait=False)


def _make_service() -> ModelService:
    return ModelService(config.WHISPER_MODELS_DIR, config.HF_MODELS_DIR, config.ALIGNMENT_MODELS_DIR)


@router.get("/models", response_model=list[ModelInfo])
def list_models():
    return _make_service().list_models()


@router.delete("/models/{model_id}")
def delete_model(model_id: str, queue=Depends(get_transcription_queue)):
    running = queue.running_job()
    # The running job has loaded these files; it may still need them (e.g. the
    # diarization model late in the pipeline). Its alignment model is known only
    # for an explicit language.
    if running and model_id in (running["whisper_model"], "diarize", running["language"]):
        return JSONResponse({"detail": "In use by the running transcription"}, status_code=409)
    try:
        _make_service().delete_model(model_id)
    except FileNotFoundError:
        return JSONResponse({"detail": f'Model "{model_id}" is not installed'}, status_code=404)
    except ValueError:
        return JSONResponse({"detail": f"Unknown model '{model_id}'"}, status_code=422)
    return {"deleted": model_id}


@router.post("/models/{model_id}/download")
async def download_model(model_id: str, body: DownloadRequest = DownloadRequest()):
    svc = _make_service()
    try:
        svc.is_installed(model_id)
    except ValueError:
        return JSONResponse({"detail": f"Unknown model '{model_id}'"}, status_code=422)

    with _running_lock:
        running = _running_downloads.get(model_id)
        if running is not None:
            log.info(f"Download already running: {model_id} (job {running})")
            return {"job_id": running}
        job_id = str(uuid.uuid4())
        q = _DownloadEvents()
        cancel_event = threading.Event()
        _download_jobs[job_id] = q
        _cancel_events[job_id] = cancel_event
        _running_downloads[model_id] = job_id
    hf_token = body.hf_token or None

    def _run():
        log.info(f"Download started: {model_id} (job {job_id})")
        try:
            service = _make_service()
            service.download_model(model_id, cancel_event=cancel_event, on_progress=q.put, hf_token=hf_token)
            q.put({"type": "done"})
            log.info(f"Download complete: {model_id}")
        except CancelledError:
            log.info(f"Download cancelled: {model_id}")
            q.put({"type": "cancelled"})
        except ModelDownloadError as exc:
            log.error(f"Download error ({exc.code}): {model_id}: {exc}")
            q.put({"type": "error", "message": str(exc), "code": exc.code})
        except ValueError as exc:
            log.error(f"Download error (ValueError): {model_id}: {exc}")
            q.put({"type": "error", "message": str(exc), "code": "failed"})
        except Exception as exc:
            log.error(f"Download error: {model_id}: {exc}", exc_info=True)
            q.put({"type": "error", "message": str(exc), "code": "failed"})
        finally:
            with _running_lock:
                _cancel_events.pop(job_id, None)
                _running_downloads.pop(model_id, None)
                _finished_jobs.append(job_id)
                while len(_finished_jobs) > _FINISHED_KEPT:
                    _download_jobs.pop(_finished_jobs.popleft(), None)

    loop = asyncio.get_running_loop()
    loop.run_in_executor(_executor, _run)
    return {"job_id": job_id}


@router.delete("/models/{model_id}/download/{job_id}")
async def cancel_download(model_id: str, job_id: str):
    if model_id not in WHISPER_CATALOG and model_id not in DIARIZATION_CATALOG and model_id not in ALIGNMENT_CATALOG:
        return JSONResponse({"detail": f"Unknown model '{model_id}'"}, status_code=422)
    if job_id not in _cancel_events:
        return JSONResponse({"detail": f"No active download job '{job_id}'"}, status_code=404)
    _cancel_events[job_id].set()
    return {"cancelled": job_id}


@router.websocket("/ws/models/{job_id}")
async def ws_download_progress(websocket: WebSocket, job_id: str):
    await websocket.accept()

    q = _download_jobs.get(job_id)
    if q is None:
        await websocket.send_json({"type": "error", "message": "Unknown job"})
        await websocket.close()
        return

    index = q.latest()
    try:
        while True:
            # Wait on the default thread pool, never on _executor: with every
            # download worker busy, reads queued there would never run.
            event = await asyncio.to_thread(q.get, index, _HEARTBEAT_INTERVAL)
            if event is None:
                await websocket.send_json({"type": "heartbeat"})
                continue
            index += 1
            await websocket.send_json(event)
            if event["type"] in ("done", "error", "cancelled"):
                break
    except WebSocketDisconnect:
        pass
