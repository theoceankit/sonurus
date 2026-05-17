from functools import lru_cache

from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService


@lru_cache(maxsize=1)
def get_memory_service() -> SpeakerMemoryService:
    return SpeakerMemoryService()


@lru_cache(maxsize=1)
def get_storage_service() -> TranscriptStorageService:
    return TranscriptStorageService()
