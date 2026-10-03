"""Transcription queue API.

Jobs are persisted and run one at a time by TranscriptionQueue (see
app/services/transcription_queue.py). WS /ws/queue streams a snapshot of the
queue after every change, plus job_done / job_failed events.
"""
import asyncio
import os

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

import app.config as config
from app.api.dependencies import get_transcription_queue
from app.api.schemas import (
    JobDeleted, JobUpdateRequest, QueueJob, QueueOrderRequest, QueueSettingsRequest,
    QueueSnapshot, TranscribeRequest,
)
from app.config import WHISPER_MODEL
from app.services.audio_store import discard_import, import_audio
from app.services.model_service import ALIGNMENT_CATALOG, ModelNotInstalledError, ModelService
from app.services.transcription_queue import (
    JobNotFailed, JobNotFound, JobRunning, TranscriptionQueue,
)

router = APIRouter(tags=["transcription"])

_HEARTBEAT_INTERVAL = 10  # seconds between heartbeats when the queue is quiet


def _language(value: str | None) -> str | None:
    return None if value in (None, "", "auto") else value


def _require_models(whisper_model: str | None = None, language: str | None = None,
                    check_diarize: bool = False) -> None:
    """400 unless the models a job needs are installed."""
    ms = ModelService(config.WHISPER_MODELS_DIR, config.HF_MODELS_DIR, config.ALIGNMENT_MODELS_DIR)
    if whisper_model is not None and not ms.is_installed(whisper_model):
        raise HTTPException(
            status_code=400,
            detail=str(ModelNotInstalledError("whisper_model_missing", whisper_model)),
        )
    if check_diarize and not ms.is_installed("diarize"):
        raise HTTPException(status_code=400, detail=str(ModelNotInstalledError("diarization_model_missing", "diarize")))
    # With auto-detect the language is only known mid-pipeline; a missing
    # alignment model then fails the job with error_code alignment_model_missing.
    if language in ALIGNMENT_CATALOG and not ms.is_installed(language):
        raise HTTPException(
            status_code=400,
            detail=f'Alignment model for language "{language}" is not installed. Download it in Settings.',
        )


# ── Queue ─────────────────────────────────────────────────────────────────────

@router.get("/queue", response_model=QueueSnapshot)
def get_queue(queue: TranscriptionQueue = Depends(get_transcription_queue)):
    return queue.snapshot()


@router.post("/queue/start", response_model=QueueSnapshot)
def start_queue(queue: TranscriptionQueue = Depends(get_transcription_queue)):
    queue.start()
    return queue.snapshot()


@router.post("/queue/pause", response_model=QueueSnapshot)
def pause_queue(queue: TranscriptionQueue = Depends(get_transcription_queue)):
    queue.pause()
    return queue.snapshot()


@router.post("/queue/recording/start", response_model=QueueSnapshot)
def recording_started(queue: TranscriptionQueue = Depends(get_transcription_queue)):
    """A live recording started: the queue pauses and the running job stops."""
    queue.recording_started()
    return queue.snapshot()


@router.post("/queue/recording/stop", response_model=QueueSnapshot)
def recording_stopped(queue: TranscriptionQueue = Depends(get_transcription_queue)):
    """Call after queuing the new recording (it then goes last)."""
    queue.recording_stopped()
    return queue.snapshot()


@router.put("/queue/settings", response_model=QueueSnapshot)
def update_settings(body: QueueSettingsRequest, queue: TranscriptionQueue = Depends(get_transcription_queue)):
    queue.set_start_mode(body.start_mode)
    return queue.snapshot()


@router.put("/queue/order", response_model=QueueSnapshot)
def reorder(body: QueueOrderRequest, queue: TranscriptionQueue = Depends(get_transcription_queue)):
    try:
        queue.reorder(body.job_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return queue.snapshot()


# ── Jobs ──────────────────────────────────────────────────────────────────────

@router.post("/queue/jobs", response_model=QueueJob)
async def add_job(body: TranscribeRequest, queue: TranscriptionQueue = Depends(get_transcription_queue)):
    whisper_model = body.whisper_model or WHISPER_MODEL
    language = _language(body.language)
    _require_models(whisper_model, language, check_diarize=True)

    if not os.path.isfile(body.audio_path):
        raise HTTPException(status_code=400, detail=f"audio_path not found: {body.audio_path}")
    if not os.access(body.audio_path, os.R_OK):
        raise HTTPException(status_code=400, detail=f"audio_path not readable: {body.audio_path}")

    # Copy an imported file now: the job and the transcript must not depend
    # on the user's original, which may be moved or deleted meanwhile.
    try:
        audio_path = await asyncio.to_thread(import_audio, body.audio_path, config.RECORDINGS_DIR)
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Could not copy audio file: {exc}")
    title = body.title or os.path.splitext(os.path.basename(body.audio_path))[0]
    try:
        return queue.add(audio_path=audio_path, title=title, whisper_model=whisper_model, language=language)
    except Exception:
        discard_import(audio_path, config.RECORDINGS_DIR)
        raise


@router.patch("/queue/jobs/{job_id}", response_model=QueueJob)
def update_job(job_id: str, body: JobUpdateRequest,
               queue: TranscriptionQueue = Depends(get_transcription_queue)):
    fields = {}
    if "title" in body.model_fields_set and body.title is not None:
        fields["title"] = body.title
    if "whisper_model" in body.model_fields_set and body.whisper_model is not None:
        fields["whisper_model"] = body.whisper_model
    if "language" in body.model_fields_set:
        fields["language"] = _language(body.language)
    _require_models(fields.get("whisper_model"), fields.get("language"))
    try:
        return queue.update(job_id, **fields)
    except JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found")
    except JobRunning:
        raise HTTPException(status_code=409, detail="The job is running; pause the queue to edit it")


@router.delete("/queue/jobs/{job_id}", response_model=JobDeleted)
async def delete_job(job_id: str, queue: TranscriptionQueue = Depends(get_transcription_queue)):
    """Delete a job and its audio (a running job is stopped first)."""
    if not await asyncio.to_thread(queue.delete, job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    return JobDeleted(deleted=True)


@router.post("/queue/jobs/{job_id}/retry", response_model=QueueJob)
def retry_job(job_id: str, queue: TranscriptionQueue = Depends(get_transcription_queue)):
    try:
        job = queue.get(job_id)
        if job["status"] == "failed":
            # A retry that would fail again at once is refused, like add / edit.
            _require_models(job["whisper_model"], job["language"], check_diarize=True)
        return queue.retry(job_id)
    except JobNotFound:
        raise HTTPException(status_code=404, detail="Job not found")
    except JobNotFailed:
        raise HTTPException(status_code=409, detail="Only a failed job can be retried")


# ── Live updates ──────────────────────────────────────────────────────────────

@router.websocket("/ws/queue")
async def ws_queue(websocket: WebSocket, queue: TranscriptionQueue = Depends(get_transcription_queue)):
    """Sends the current snapshot, then every snapshot and job event.
    Heartbeats keep the connection alive while nothing changes."""
    await websocket.accept()
    loop = asyncio.get_running_loop()
    events: asyncio.Queue = asyncio.Queue()

    def on_event(event: dict) -> None:
        try:
            loop.call_soon_threadsafe(events.put_nowait, event)
        except RuntimeError:
            pass  # event loop already closed

    unsubscribe = queue.subscribe(on_event)
    try:
        await websocket.send_json(queue.snapshot())
        while True:
            try:
                event = await asyncio.wait_for(events.get(), timeout=_HEARTBEAT_INTERVAL)
            except asyncio.TimeoutError:
                event = {"type": "heartbeat"}
            await websocket.send_json(event)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        unsubscribe()
