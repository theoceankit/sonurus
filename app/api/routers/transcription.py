import asyncio
import logging
import os
import threading
import uuid
import warnings
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.responses import JSONResponse

from app.services.service_factory import create_controller
from app.services.archive_service import ArchiveService
from app.services.commit_service import CommitService
from app.services.model_service import ModelService
from app.api.schemas import TranscribeRequest, JobStarted
import app.config as config
from app.config import WHISPER_MODEL

_VERBOSE = os.getenv("VERBOSE", "false").lower() == "true"

_NOISY_LOGGERS = [
    "whisperx", "whisperx.asr", "whisperx.vads.pyannote", "whisperx.diarize",
    "lightning", "lightning.pytorch", "lightning.fabric",
    "lightning.fabric.utilities.rank_zero",
    "lightning.pytorch.utilities.upgrade_checkpoint",
    "pytorch_lightning",
]


def _suppress_noise():
    warnings.filterwarnings("ignore", module="lightning")
    warnings.filterwarnings("ignore", module="pyannote")
    warnings.filterwarnings("ignore", module="torch")
    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.ERROR)
    for name, logger in logging.root.manager.loggerDict.items():
        if isinstance(logger, logging.Logger):
            if any(name.startswith(p) for p in ("lightning", "pytorch_lightning", "pyannote", "whisperx")):
                logger.setLevel(logging.ERROR)

router = APIRouter(tags=["transcription"])

_executor = ThreadPoolExecutor(max_workers=1)

# job_id → asyncio.Queue of progress events
_jobs: dict[str, asyncio.Queue] = {}
# job_id → threading.Event set to cancel the running job
_cancel_events: dict[str, threading.Event] = {}

_HEARTBEAT_INTERVAL = 10  # seconds between heartbeats when pipeline is silent


class _JobCancelled(Exception):
    pass


@router.post("/transcribe", response_model=JobStarted)
async def start_transcribe(body: TranscribeRequest):
    whisper_model = body.whisper_model or WHISPER_MODEL
    ms = ModelService(config.WHISPER_MODELS_DIR, config.HF_MODELS_DIR)
    if not ms.is_installed(whisper_model):
        return JSONResponse(
            {"detail": f"Whisper model '{whisper_model}' is not installed. Download it in Settings."},
            status_code=400,
        )
    if not ms.is_installed("diarize"):
        return JSONResponse(
            {"detail": "Diarization model is not installed. Download it in Settings."},
            status_code=400,
        )

    job_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    cancel_event = threading.Event()
    _jobs[job_id] = queue
    _cancel_events[job_id] = cancel_event

    loop = asyncio.get_running_loop()

    def _run():
        try:
            if not _VERBOSE:
                _suppress_noise()

            def on_progress(step: str):
                if cancel_event.is_set():
                    raise _JobCancelled()
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "progress", "step": step})

            on_progress("Loading models…")
            controller, storage = create_controller(whisper_model=body.whisper_model or WHISPER_MODEL)

            transcript = controller.run_pipeline(body.audio_path, on_progress=on_progress, language=body.language)

            if cancel_event.is_set():
                raise _JobCancelled()

            on_progress("Saving to database…")
            storage.save(transcript)
            CommitService(controller.memory_service, storage).commit_recognized_speakers(transcript)
            ArchiveService().archive(transcript)

            controller.transcription_service.model = None
            controller.embedding_service.inference = None
            del controller
            import gc; gc.collect()
            import torch; torch.cuda.empty_cache()

            loop.call_soon_threadsafe(
                queue.put_nowait,
                {"type": "done", "transcript_id": transcript.db_id},
            )
        except _JobCancelled:
            loop.call_soon_threadsafe(
                queue.put_nowait,
                {"type": "cancelled"},
            )
        except Exception as exc:
            loop.call_soon_threadsafe(
                queue.put_nowait,
                {"type": "error", "message": str(exc)},
            )
        finally:
            _cancel_events.pop(job_id, None)

    loop.run_in_executor(_executor, _run)
    return JobStarted(job_id=job_id)


@router.delete("/transcribe/{job_id}")
async def cancel_transcribe(job_id: str):
    cancel_event = _cancel_events.get(job_id)
    if cancel_event:
        cancel_event.set()
        return JSONResponse({"cancelled": True})
    return JSONResponse({"cancelled": False}, status_code=404)


@router.websocket("/ws/{job_id}")
async def ws_progress(websocket: WebSocket, job_id: str):
    await websocket.accept()

    queue = _jobs.get(job_id)
    if queue is None:
        await websocket.send_json({"type": "error", "message": "Unknown job"})
        await websocket.close()
        return

    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_INTERVAL)
            except asyncio.TimeoutError:
                # Keep the connection alive during long model downloads
                await websocket.send_json({"type": "heartbeat"})
                continue

            await websocket.send_json(event)
            if event["type"] in ("done", "error", "cancelled"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        _jobs.pop(job_id, None)
