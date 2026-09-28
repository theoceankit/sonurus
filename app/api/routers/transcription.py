import asyncio
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from app.services import pipeline_process
from app.services.pipeline_process import PipelineCancelled, run_pipeline_process
from app.services.service_factory import create_controller
from app.services.audio_store import discard_import, import_audio
from app.services.commit_service import CommitService
from app.services.model_service import ModelService, ALIGNMENT_CATALOG
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.transcription_service import AlignmentModelMissingError
from app.api.schemas import TranscribeRequest, JobStarted
from app.api.dependencies import get_memory_service, get_storage_service
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


def _release_models(controller) -> None:
    """Drop model references and return cached GPU memory to the driver.

    Runs after every job — success, error or cancel — so a failed job does
    not keep several GiB of VRAM allocated until the next one starts. Only
    matters in-process (tests): a child process frees everything on exit.
    """
    if controller is not None:
        controller.transcription_service.model = None
        controller.embedding_service.inference = None
    import gc
    gc.collect()
    import torch
    torch.cuda.empty_cache()


@router.post("/transcribe", response_model=JobStarted)
async def start_transcribe(
    body: TranscribeRequest,
    api_memory: SpeakerMemoryService = Depends(get_memory_service),
    storage: TranscriptStorageService = Depends(get_storage_service),
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

    # Copy an imported file now, before the job queues: the transcript must
    # stay playable after the user moves or deletes the original.
    try:
        audio_path = await asyncio.to_thread(import_audio, body.audio_path, config.RECORDINGS_DIR)
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Could not copy audio file: {exc}")
    title = body.title or os.path.splitext(os.path.basename(body.audio_path))[0]

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
        controller = None
        saved = False
        try:
            if not _VERBOSE:
                suppress_ml_noise("thread")

            _emit({"type": "started"})

            def on_progress(step: str):
                if cancel_event.is_set():
                    raise PipelineCancelled()
                _emit({"type": "progress", "step": step})

            on_progress("Loading models…")
            if pipeline_process.RUN_PIPELINE_IN_SUBPROCESS:
                # The child only computes; saving and commit happen here.
                transcript = run_pipeline_process(
                    {"audio_path": audio_path, "whisper_model": whisper_model,
                     "language": body.language, "db_path": api_memory.db_path},
                    on_progress, cancel_event,
                )
                memory, job_storage = SpeakerMemoryService(db_path=api_memory.db_path), storage
            else:
                controller, job_storage = create_controller(whisper_model=whisper_model)
                transcript = controller.run_pipeline(audio_path, on_progress=on_progress, language=body.language)
                memory = controller.memory_service

            if cancel_event.is_set():
                raise PipelineCancelled()

            transcript.title = title

            on_progress("Saving to database…")
            job_storage.save(transcript)
            saved = True  # from here on the transcript references the copy
            CommitService(memory, job_storage).commit_recognized_speakers(transcript)
            api_memory.reload()

            _emit({"type": "done", "transcript_id": transcript.db_id})
        except PipelineCancelled:
            _emit({"type": "cancelled"})
        except AlignmentModelMissingError as exc:
            # Emit a structured error so the frontend can offer a targeted
            # download prompt instead of showing a generic error message.
            _emit({"type": "error", "error_code": "alignment_model_missing", "language": exc.language})
        except Exception as exc:
            _emit({"type": "error", "message": str(exc)})
        finally:
            if not saved:
                discard_import(audio_path, config.RECORDINGS_DIR)
            _release_models(controller)
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
        # The client went away (renderer reload, transient error). The job keeps
        # running and its queue stays registered, so a client can reconnect;
        # _run() unregisters it when the job ends. Cancelling is explicit only
        # (DELETE /transcribe/{job_id}).
        pass
