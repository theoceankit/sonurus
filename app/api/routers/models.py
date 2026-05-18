import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

import app.config as config
from app.services.model_service import ModelService

router = APIRouter(tags=["models"])

_executor = ThreadPoolExecutor(max_workers=2)

# job_id → asyncio.Queue of download events
_download_jobs: dict[str, asyncio.Queue] = {}

ModelId = Literal["tiny", "base", "small", "medium", "large-v3"]


@router.get("/models")
def list_models():
    service = ModelService(config.WHISPER_MODELS_DIR)
    return service.list_models()


@router.delete("/models/{model_id}")
def delete_model(model_id: ModelId):
    service = ModelService(config.WHISPER_MODELS_DIR)
    try:
        service.delete_model(model_id)
    except FileNotFoundError:
        return JSONResponse({"detail": f"Model '{model_id}' is not installed"}, status_code=404)
    return {"deleted": model_id}


@router.post("/models/{model_id}/download")
async def download_model(model_id: ModelId):
    job_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    _download_jobs[job_id] = queue

    loop = asyncio.get_running_loop()

    def _run():
        try:
            service = ModelService(config.WHISPER_MODELS_DIR)

            def on_progress(event):
                loop.call_soon_threadsafe(queue.put_nowait, event)

            service.download_model(model_id, on_progress=on_progress)
        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": str(exc)})

    loop.run_in_executor(_executor, _run)
    return {"job_id": job_id}


@router.websocket("/ws/models/{job_id}")
async def ws_download_progress(websocket: WebSocket, job_id: str):
    await websocket.accept()

    queue = _download_jobs.get(job_id)
    if queue is None:
        await websocket.send_json({"type": "error", "message": "Unknown job"})
        await websocket.close()
        return

    try:
        while True:
            event = await queue.get()
            await websocket.send_json(event)
            if event["type"] in ("done", "error"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        _download_jobs.pop(job_id, None)
