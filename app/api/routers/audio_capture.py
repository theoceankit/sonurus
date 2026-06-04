from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.dependencies import get_audio_capture_service

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


@router.get("/audio/capture/sources", response_model=AudioSourcesResponse)
def get_sources(service=Depends(get_audio_capture_service)):
    return AudioSourcesResponse(sources=service.get_sources())


@router.post("/audio/capture/start", response_model=AudioCaptureStartResponse)
def start_capture(body: AudioCaptureStartRequest = AudioCaptureStartRequest(), service=Depends(get_audio_capture_service)):
    job_id = service.start_capture(source_id=body.source_id)
    return AudioCaptureStartResponse(job_id=job_id)


@router.post("/audio/capture/stop/{job_id}", response_model=AudioCaptureStopResponse)
def stop_capture(job_id: str, body: AudioCaptureStopRequest = AudioCaptureStopRequest(), service=Depends(get_audio_capture_service)):
    try:
        file_path = service.stop_capture(job_id, mic_path=body.mic_path)
    except ValueError:
        raise HTTPException(status_code=404, detail="Job not found")
    return AudioCaptureStopResponse(file_path=file_path)
