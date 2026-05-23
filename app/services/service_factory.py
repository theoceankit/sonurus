from app.config import DEVICE, MODELS_DIR, WHISPER_MODEL
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.embedding_service import EmbeddingService
from app.services.transcription_service import TranscriptionService
from app.services.commit_service import CommitService
from app.services.transcript_storage_service import TranscriptStorageService
from app.controllers.transcription_controller import TranscriptionController


def create_controller(
    db_path: str = "speaker_memory.db",
    device: str = DEVICE,
    whisper_model: str = WHISPER_MODEL,
) -> tuple[TranscriptionController, TranscriptStorageService]:
    """
    Constructs all services and returns a ready controller + storage service.

    Raises RuntimeError if ML models fail to load (missing files, bad HF token).
    Returns a tuple so callers can access storage_service for save() after pipeline.
    """
    memory_service        = SpeakerMemoryService(db_path=db_path)
    transcription_service = TranscriptionService(device, MODELS_DIR, model_name=whisper_model)
    embedding_service     = EmbeddingService(device, models_dir=MODELS_DIR)
    storage_service       = TranscriptStorageService(db_path=db_path)
    commit_service        = CommitService(memory_service, storage_service)

    controller = TranscriptionController(
        transcription_service=transcription_service,
        embedding_service=embedding_service,
        memory_service=memory_service,
        commit_service=commit_service,
        storage_service=storage_service,
    )
    return controller, storage_service
