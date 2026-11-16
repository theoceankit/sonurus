"""What a transcription job needs installed, checked before the job is
queued or a recording that will become one starts."""
import app.config as config
from app.api.refusals import Refusal
from app.services.model_service import ALIGNMENT_CATALOG, ModelNotInstalledError, ModelService


def job_language(value: str | None) -> str | None:
    """null, "" or "auto" = auto-detect."""
    return None if value in (None, "", "auto") else value


def require_models(whisper_model: str | None = None, language: str | None = None,
                   check_diarize: bool = False) -> None:
    """400 unless the models a job needs are installed."""
    ms = ModelService(config.WHISPER_MODELS_DIR, config.HF_MODELS_DIR, config.ALIGNMENT_MODELS_DIR)
    if whisper_model is not None and not ms.is_installed(whisper_model):
        raise Refusal("whisper_model_missing", str(ModelNotInstalledError("whisper_model_missing", whisper_model)))
    if check_diarize and not ms.is_installed("diarize"):
        raise Refusal("diarization_model_missing", str(ModelNotInstalledError("diarization_model_missing", "diarize")))
    # With auto-detect the language is only known mid-pipeline; a missing
    # alignment model then fails the job with error_code alignment_model_missing.
    if language in ALIGNMENT_CATALOG and not ms.is_installed(language):
        raise Refusal(
            "alignment_model_missing",
            f'Alignment model for language "{language}" is not installed. Download it in Settings.',
        )
