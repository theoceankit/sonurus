import os
import torch
from pathlib import Path

# Reduces CUDA memory fragmentation — must be set before any CUDA allocation.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

_data_dir = Path(os.getenv("SONORUS_DATA_DIR", "."))
MODELS_DIR = _data_dir / ".models"
WHISPER_MODELS_DIR = MODELS_DIR / "whisper"
HF_MODELS_DIR = MODELS_DIR / "hf"
ALIGNMENT_MODELS_DIR = MODELS_DIR / "alignment"

# Device
DEVICE: str = "cuda" if torch.cuda.is_available() else "cpu"

# TranscriptionService
WHISPER_MODEL = "large-v3"
WHISPER_BATCH_SIZE = 2  # lower batch = less activation memory during transcription
WHISPER_COMPUTE_TYPE_CPU = "int8"

# int8_float16 requires Turing (CC >= 7.5); fall back to float16 on older GPUs
WHISPER_COMPUTE_TYPE_CUDA = "int8_float16"
if DEVICE == "cuda":
    try:
        _cc = torch.cuda.get_device_capability()
        if _cc < (7, 5):
            WHISPER_COMPUTE_TYPE_CUDA = "float16"
    except Exception:
        pass

# EmbeddingService
EMBEDDING_SAMPLE_RATE = 16000
EMBEDDING_MIN_DURATION = 1.0

# SpeakerMemoryService
SPEAKER_SIMILARITY_THRESHOLD = 0.75

# Database
DB_PATH = os.getenv("DB_PATH", str(_data_dir / "speaker_memory.db"))
