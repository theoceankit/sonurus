"""Live recording: the audio sources it can take, and the recording itself,
which the backend runs from start to the queue (LiveRecordingService). Its
state is in the queue snapshot, GET /queue and WS /ws/queue."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.dependencies import get_audio_capture_service, get_live_recording_service, get_mic_activity_service
from app.api.required_models import job_language, require_models
from app.api.schemas import LiveRecording, MicWatchResponse
from app.config import WHISPER_MODEL
from app.services.live_recording_service import NotRecording, RecordingBusy, RecordingRequest

router = APIRouter()


class AudioSource(BaseModel):
    id: str
    label: str


class AudioSourcesResponse(BaseModel):
    sources: list[AudioSource]


class AudioInputsResponse(BaseModel):
    """The microphones; the default one is not listed (mic_device null)."""
    inputs: list[AudioSource]


class RecordingStartRequest(BaseModel):
    """POST /audio/recording/start. mic_device / system_source null = the
    default; whisper_model null = the default model; language null or
    "auto" = auto-detect. The recording is queued with title, model and
    language when it stops."""
    mic: bool
    mic_device: str | None = None
    system: bool
    system_source: str | None = None
    title: str = Field(min_length=1, max_length=200)
    whisper_model: str | None = None
    language: str | None = None


@router.get("/audio/capture/sources", response_model=AudioSourcesResponse)
def get_sources(service=Depends(get_audio_capture_service)):
    return AudioSourcesResponse(sources=service.get_sources())


@router.get("/audio/capture/inputs", response_model=AudioInputsResponse)
def get_inputs(service=Depends(get_audio_capture_service)):
    return AudioInputsResponse(inputs=service.get_inputs())


@router.get("/audio/mic-watch", response_model=MicWatchResponse)
def get_mic_watch(service=Depends(get_mic_activity_service)):
    """Whether this system tells when another app holds a microphone (the
    mic_app_active and call_ended events), and whether it names the app."""
    return MicWatchResponse(**service.support())


@router.post("/audio/recording/start", response_model=LiveRecording,
             responses={400: {"description": "The recording cannot start; detail says why"},
                        409: {"description": "A recording is already in progress"}})
def start_recording(body: RecordingStartRequest, recording=Depends(get_live_recording_service)):
    whisper_model = body.whisper_model or WHISPER_MODEL
    language = job_language(body.language)
    # Refused now rather than after the recording, when it could not be queued.
    require_models(whisper_model, language, check_diarize=True)
    request = RecordingRequest(mic=body.mic, mic_device=body.mic_device, system=body.system,
                               system_source=body.system_source, title=body.title.strip(),
                               whisper_model=whisper_model, language=language)
    try:
        return recording.start(request)
    except RecordingBusy:
        raise HTTPException(status_code=409, detail="A recording is already in progress")
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/audio/recording/stop", response_model=LiveRecording,
             responses={409: {"description": "No recording is in progress"}})
def stop_recording(recording=Depends(get_live_recording_service)):
    """Answers at once (phase stopping); the recording is saved and queued
    after, and its end comes over WS /ws/queue."""
    try:
        return recording.stop()
    except NotRecording:
        raise HTTPException(status_code=409, detail="No recording is in progress")
