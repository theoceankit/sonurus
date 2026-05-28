import asyncio
import queue as _queue
import threading
import uuid
from asyncio import CancelledError
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

import app.config as config
from app.services.model_service import ModelService
from app.logger import get_logger

log = get_logger("models")

router = APIRouter(tags=["models"])

_executor = ThreadPoolExecutor(max_workers=2)

# job_id → threading.Queue carrying a single terminal event (done/error/cancelled)
_download_jobs: dict[str, _queue.Queue] = {}
# job_id → threading.Event for cancellation
_cancel_events: dict[str, threading.Event] = {}


def shutdown_executor():
    _executor.shutdown(wait=False)


def _make_service() -> ModelService:
    return ModelService(config.WHISPER_MODELS_DIR, config.HF_MODELS_DIR, config.ALIGNMENT_MODELS_DIR)


@router.get("/models")
def list_models():
    return _make_service().list_models()


@router.delete("/models/{model_id}")
def delete_model(model_id: str):
    try:
        _make_service().delete_model(model_id)
    except FileNotFoundError:
        return JSONResponse({"detail": f"Model '{model_id}' is not installed"}, status_code=404)
    except ValueError:
        return JSONResponse({"detail": f"Unknown model '{model_id}'"}, status_code=422)
    return {"deleted": model_id}


@router.post("/models/{model_id}/download")
async def download_model(model_id: str):
    svc = _make_service()
    try:
        svc.is_installed(model_id)
    except ValueError:
        return JSONResponse({"detail": f"Unknown model '{model_id}'"}, status_code=422)

    job_id = str(uuid.uuid4())
    q: _queue.Queue = _queue.Queue()
    cancel_event = threading.Event()
    _download_jobs[job_id] = q
    _cancel_events[job_id] = cancel_event

    def _run():
        log.info(f"Download started: {model_id} (job {job_id})")
        try:
            service = _make_service()
            service.download_model(model_id, cancel_event=cancel_event, on_progress=q.put)
            q.put({"type": "done"})
            log.info(f"Download complete: {model_id}")
        except CancelledError:
            log.info(f"Download cancelled: {model_id}")
            q.put({"type": "cancelled"})
        except ValueError as exc:
            log.error(f"Download error (ValueError): {model_id}: {exc}")
            q.put({"type": "error", "message": str(exc)})
        except Exception as exc:
            log.error(f"Download error: {model_id}: {exc}", exc_info=True)
            q.put({"type": "error", "message": str(exc)})
        finally:
            _cancel_events.pop(job_id, None)

    loop = asyncio.get_running_loop()
    loop.run_in_executor(_executor, _run)
    return {"job_id": job_id}


@router.delete("/models/{model_id}/download/{job_id}")
async def cancel_download(model_id: str, job_id: str):
    from app.services.model_service import WHISPER_CATALOG, DIARIZATION_CATALOG, ALIGNMENT_CATALOG
    if model_id not in WHISPER_CATALOG and model_id not in DIARIZATION_CATALOG and model_id not in ALIGNMENT_CATALOG:
        return JSONResponse(
            {"detail": [{"type": "literal_error", "loc": ["path", "model_id"], "msg": f"Input should be a valid model id", "input": model_id, "ctx": {"expected": "a known model id"}}]},
            status_code=422,
        )
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

    loop = asyncio.get_running_loop()
    try:
        while True:
            try:
                event = await loop.run_in_executor(_executor, lambda: q.get(timeout=15))
            except _queue.Empty:
                await websocket.send_json({"type": "heartbeat"})
                continue
            await websocket.send_json(event)
            if event["type"] in ("done", "error", "cancelled"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        _download_jobs.pop(job_id, None)
        # _cancel_events is cleaned up by _run()'s finally — not here
