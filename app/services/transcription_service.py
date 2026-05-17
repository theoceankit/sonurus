import whisperx
import torch
from pathlib import Path

from app.config import MODELS_DIR, WHISPER_MODEL, WHISPER_BATCH_SIZE, WHISPER_COMPUTE_TYPE_CUDA, WHISPER_COMPUTE_TYPE_CPU
from app.logger import get_logger

log = get_logger("TranscriptionService")


class TranscriptionService:
    def __init__(self, device: str, models_dir: Path = MODELS_DIR):
        self.device = device
        self.models_dir = models_dir

        log.info(f"Loading WhisperX model (device={device})...")
        compute_type = WHISPER_COMPUTE_TYPE_CUDA if device == "cuda" else WHISPER_COMPUTE_TYPE_CPU
        try:
            self.model = whisperx.load_model(
                WHISPER_MODEL,
                device,
                compute_type=compute_type,
                download_root=str(models_dir / "whisper"),
            )
        except (OSError, RuntimeError) as exc:
            raise RuntimeError(f"Failed to load Whisper model: {exc}") from exc

    def transcribe(self, audio_path: str):
        log.info(f"Loading audio: {audio_path}")
        audio = whisperx.load_audio(audio_path)

        log.info("Transcribing...")
        result = self.model.transcribe(audio, batch_size=WHISPER_BATCH_SIZE)

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