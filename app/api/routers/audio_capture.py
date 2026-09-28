from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

import app.config as config
from app.api.dependencies import get_audio_capture_service
from app.services.audio_store import save_recording

router = APIRouter()


class AudioSource(BaseModel):
    id: str
    label: str


class AudioSourcesResponse(BaseModel):
    sources: list[AudioSource]


class AudioCaptureStartRequest(BaseModel):
    source_id: str | None = None


class AudioCaptureStartResponse(BaseModel):
    job_id: str


class AudioCaptureStopRequest(BaseModel):
    mic_path: str | None = None


class AudioCaptureStopResponse(BaseModel):
    file_path: str


class RecordingUploadResponse(BaseModel):
    file_path: str


_RECORDING_TYPES = {
    "audio/webm": "webm",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
}


@router.get("/audio/capture/sources", response_model=AudioSourcesResponse)
def get_sources(service=Depends(get_audio_capture_service)):
    return AudioSourcesResponse(sources=service.get_sources())


@router.post("/audio/capture/start", response_model=AudioCaptureStartResponse)
def start_capture(body: AudioCaptureStartRequest = AudioCaptureStartRequest(), service=Depends(get_audio_capture_service)):
    try:
        job_id = service.start_capture(source_id=body.source_id)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return AudioCaptureStartResponse(job_id=job_id)


@router.post("/audio/capture/stop/{job_id}", response_model=AudioCaptureStopResponse)
def stop_capture(job_id: str, body: AudioCaptureStopRequest = AudioCaptureStopRequest(), service=Depends(get_audio_capture_service)):
    try:
        file_path = service.stop_capture(job_id, mic_path=body.mic_path)
    except ValueError:
        raise HTTPException(status_code=404, detail="Job not found")
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return AudioCaptureStopResponse(file_path=file_path)


@router.post("/audio/recordings", response_model=RecordingUploadResponse, status_code=201)
async def upload_recording(request: Request):
    """Store a live recording (raw body, Content-Type audio/webm or audio/wav)
    in RECORDINGS_DIR. The backend is the only writer of that dir, so the UI
    uploads instead of writing a file wherever its own data dir is."""
    mime = request.headers.get("content-type", "").split(";")[0].strip().lower()
    ext = _RECORDING_TYPES.get(mime)
    if ext is None:
        raise HTTPException(status_code=415, detail=f"Unsupported recording type: {mime or 'none'}")
    try:
        file_path = await save_recording(request.stream(), ext, config.RECORDINGS_DIR)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not save the recording: {e}")
    return RecordingUploadResponse(file_path=file_path)
