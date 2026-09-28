from functools import lru_cache

import app.config as config
from app.config import DB_PATH
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService


@lru_cache(maxsize=1)
def get_memory_service() -> SpeakerMemoryService:
    return SpeakerMemoryService(db_path=DB_PATH)


@lru_cache(maxsize=1)
def get_storage_service() -> TranscriptStorageService:
    return TranscriptStorageService(db_path=DB_PATH)


from app.services.audio_capture_service import AudioCaptureService


@lru_cache(maxsize=1)
def get_audio_capture_service() -> AudioCaptureService:
    return AudioCaptureService()


from app.services.job_store import JobStore
from app.services.transcription_job import make_job_runner
from app.services.transcription_queue import TranscriptionQueue


@lru_cache(maxsize=1)
def get_transcription_queue() -> TranscriptionQueue:
    """The queue; its worker is started and stopped by the app lifespan."""
    memory = get_memory_service()
    run_job = make_job_runner(storage=get_storage_service(), memory_db_path=DB_PATH, on_saved=memory.reload)
    return TranscriptionQueue(JobStore(db_path=DB_PATH), run_job, recordings_dir=config.RECORDINGS_DIR)
