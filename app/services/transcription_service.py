import whisperx
import torch
from pathlib import Path

from app.config import MODELS_DIR, WHISPER_MODEL, WHISPER_BATCH_SIZE, WHISPER_COMPUTE_TYPE_CUDA, WHISPER_COMPUTE_TYPE_CPU
from app.services.model_service import ALIGNMENT_CATALOG
from app.logger import get_logger

log = get_logger("TranscriptionService")


class AlignmentModelMissingError(Exception):
    """Raised inside transcribe() when the detected language needs an alignment
    model that is not installed on disk.  Carries the ISO language code so the
    caller can surface a targeted download prompt."""

    def __init__(self, language: str) -> None:
        self.language = language
        super().__init__(
            f"Alignment model for language '{language}' is not installed. "
            "Download it in Settings → Alignment Models."
        )


class TranscriptionService:
    def __init__(self, device: str, models_dir: Path = MODELS_DIR, model_name: str = WHISPER_MODEL):
        self.device = device
        self.models_dir = models_dir

        log.info(f"Loading WhisperX model (device={device})...")
        compute_type = WHISPER_COMPUTE_TYPE_CUDA if device == "cuda" else WHISPER_COMPUTE_TYPE_CPU
        try:
            self.model = whisperx.load_model(
                model_name,
                device,
                compute_type=compute_type,
                download_root=str(models_dir / "whisper"),
            )
        except (OSError, RuntimeError) as exc:
            raise RuntimeError(f"Failed to load Whisper model: {exc}") from exc

    def transcribe(self, audio_path: str, language: str | None = None):
        log.info(f"Loading audio: {audio_path}")
        audio = whisperx.load_audio(audio_path)

        log.info("Transcribing...")
        result = self.model.transcribe(audio, batch_size=WHISPER_BATCH_SIZE, language=language or None)

        # Guard: when the language was auto-detected (language=None), the HTTP
        # pre-flight in the router cannot check it in advance.  Check here
        # before load_align_model silently downloads the model.
        detected_lang = result.get("language")
        if detected_lang and detected_lang in ALIGNMENT_CATALOG:
            hf_repo = ALIGNMENT_CATALOG[detected_lang]["hf_repo"].replace("/", "--")
            refs_main = self.models_dir / "alignment" / f"models--{hf_repo}" / "refs" / "main"
            if not refs_main.exists():
                raise AlignmentModelMissingError(detected_lang)

        log.info(f"Aligning (language={result['language']})...")
        align_model, metadata = whisperx.load_align_model(
            language_code=result["language"],
            device=self.device,
            model_dir=str(self.models_dir / "alignment"),
        )

        torch.cuda.empty_cache()

        result = whisperx.align(
            result["segments"],
            align_model,
            metadata,
            audio,
            self.device
        )

        log.info("Diarizing...")
        diarize_model = whisperx.diarize.DiarizationPipeline(
            device=self.device,
            cache_dir=str(self.models_dir / "hf"),
        )

        diarization = diarize_model(audio)

        result = whisperx.assign_word_speakers(
            diarization,
            result
        )

        log.info(f"Done — {len(result['segments'])} segments")

        # Free temporary GPU models immediately — align_model and diarize_model
        # are PyTorch-based and hold several GiB of VRAM. Without explicit
        # deletion here, Python's GC may delay collection until the next cycle,
        # leaving VRAM occupied when the next pipeline run tries to load models.
        del align_model, diarize_model
        import gc
        gc.collect()
        torch.cuda.empty_cache()

        return result, audio, diarization