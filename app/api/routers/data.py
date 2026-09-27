from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

import app.config as config
from app.api.dependencies import get_audio_capture_service, get_memory_service, get_storage_service
from app.api.routers import transcription
from app.api.schemas import DataResetResponse
from app.services.archive_service import ArchiveService
from app.services.data_reset_service import DataResetService
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService

router = APIRouter(prefix="/data", tags=["data"])


@router.post("/reset", response_model=DataResetResponse)
def reset_data(
    storage: TranscriptStorageService = Depends(get_storage_service),
    memory: SpeakerMemoryService = Depends(get_memory_service),
    capture=Depends(get_audio_capture_service),
):
    # A running pipeline job holds its own memory snapshot and would write the
    # transcript and speakers back after the reset; a running capture would
    # drop a new file into the recordings dir.
    if transcription._jobs:
        raise HTTPException(status_code=409, detail="A transcription is in progress")
    if capture.has_active_jobs():
        raise HTTPException(status_code=409, detail="A recording is in progress")
    service = DataResetService(
        storage, memory, [config.RECORDINGS_DIR, Path(ArchiveService.BASE_DIR)]
    )
    return DataResetResponse(**service.reset())
