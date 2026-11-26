import app.config as config
from app.config import DEVICE, MODELS_DIR, WHISPER_MODEL
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.embedding_service import EmbeddingService
from app.services.transcription_service import TranscriptionService
from app.services.transcript_storage_service import TranscriptStorageService
from app.controllers.transcription_controller import TranscriptionController


def create_controller(
    db_path: str | None = None,
    device: str = DEVICE,
    whisper_model: str = WHISPER_MODEL,
    diarize: bool = True,
) -> tuple[TranscriptionController, TranscriptStorageService]:
    """
    Constructs all services and returns a ready controller + storage service.

    Without diarize there is no embedding service: it loads its model, part of
    the diarization repo, as it is made.

    Raises RuntimeError if ML models fail to load (missing files, bad HF token).
    Returns a tuple so callers can access storage_service for save() after pipeline.
    """
    if db_path is None:  # read at call time: tests point DB_PATH elsewhere
        db_path = config.DB_PATH
    memory_service        = SpeakerMemoryService(db_path=db_path)
    transcription_service = TranscriptionService(device, MODELS_DIR, model_name=whisper_model)
    embedding_service     = EmbeddingService(device, models_dir=MODELS_DIR) if diarize else None
    storage_service       = TranscriptStorageService(db_path=db_path)

    controller = TranscriptionController(
        transcription_service=transcription_service,
        embedding_service=embedding_service,
        memory_service=memory_service,
    )
    return controller, storage_service
