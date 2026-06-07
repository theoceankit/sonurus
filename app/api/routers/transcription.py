import asyncio
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from app.services.service_factory import create_controller
from app.services.archive_service import ArchiveService
from app.services.commit_service import CommitService
from app.services.model_service import ModelService, ALIGNMENT_CATALOG
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcription_service import AlignmentModelMissingError
from app.api.schemas import TranscribeRequest, JobStarted
from app.api.dependencies import get_memory_service
import app.config as config
from app.config import WHISPER_MODEL

from app.warnings import suppress_ml_noise

_VERBOSE = os.getenv("VERBOSE", "false").lower() == "true"

router = APIRouter(tags=["transcription"])

_executor = ThreadPoolExecutor(max_workers=1)

# job_id → asyncio.Queue of progress events
_jobs: dict[str, asyncio.Queue] = {}
# job_id → threading.Event set to cancel the running job
_cancel_events: dict[str, threading.Event] = {}

_HEARTBEAT_INTERVAL = 10  # seconds between heartbeats when pipeline is silent


def shutdown_executor():
    _executor.shutdown(wait=False)


class _JobCancelled(Exception):
    pass


@router.post("/transcribe", response_model=JobStarted)
async def start_transcribe(
    body: TranscribeRequest,
    api_memory: SpeakerMemoryService = Depends(get_memory_service),
):
    whisper_model = body.whisper_model or WHISPER_MODEL
    ms = ModelService(config.WHISPER_MODELS_DIR, config.HF_MODELS_DIR, config.ALIGNMENT_MODELS_DIR)
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
    if body.language and body.language != "auto" and body.language in ALIGNMENT_CATALOG:
        if not ms.is_installed(body.language):
            raise HTTPException(
                status_code=400,
                detail=f"Alignment model for language '{body.language}' is not installed. Download it in Settings.",
            )

    if not os.path.isfile(body.audio_path):
        raise HTTPException(status_code=400, detail=f"audio_path not found: {body.audio_path}")
    if not os.access(body.audio_path, os.R_OK):
        raise HTTPException(status_code=400, detail=f"audio_path not readable: {body.audio_path}")

    job_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    cancel_event = threading.Event()
    _jobs[job_id] = queue
    _cancel_events[job_id] = cancel_event
    queue.put_nowait({"type": "queued"})

    loop = asyncio.get_running_loop()

    def _emit(event: dict) -> None:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, event)
        except RuntimeError:
            pass  # event loop already closed (e.g. test teardown)

    def _run():
        try:
            if not _VERBOSE:
                suppress_ml_noise("thread")

            _emit({"type": "started"})

            def on_progress(step: str):
                if cancel_event.is_set():
                    raise _JobCancelled()
                _emit({"type": "progress", "step": step})

            on_progress("Loading models…")
            controller, storage = create_controller(whisper_model=body.whisper_model or WHISPER_MODEL)

            transcript = controller.run_pipeline(body.audio_path, on_progress=on_progress, language=body.language)

            if cancel_event.is_set():
                raise _JobCancelled()

            if body.title:
                transcript.title = body.title

            on_progress("Saving to database…")
            storage.save(transcript)
            CommitService(controller.memory_service, storage).commit_recognized_speakers(transcript)
            api_memory.reload()
            ArchiveService().archive(transcript, display_fn=controller.get_display_name)

            controller.transcription_service.model = None
            controller.embedding_service.inference = None
            del controller
            import gc; gc.collect()
            import torch; torch.cuda.empty_cache()

            _emit({"type": "done", "transcript_id": transcript.db_id})
        except _JobCancelled:
            _emit({"type": "cancelled"})
        except AlignmentModelMissingError as exc:
            # Emit a structured error so the frontend can offer a targeted
            # download prompt instead of showing a generic error message.
            _emit({"type": "error", "error_code": "alignment_model_missing", "language": exc.language})
        except Exception as exc:
            _emit({"type": "error", "message": str(exc)})
        finally:
            _jobs.pop(job_id, None)
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
        cancel_event = _cancel_events.get(job_id)
        if cancel_event:
            cancel_event.set()
    finally:
        _jobs.pop(job_id, None)
