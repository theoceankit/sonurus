from functools import lru_cache

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
