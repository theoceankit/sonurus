import os
import torch
from pathlib import Path

# Reduces CUDA memory fragmentation — must be set before any CUDA allocation.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

MODELS_DIR = Path(".models")

# Device
DEVICE: str = "cuda" if torch.cuda.is_available() else "cpu"

# TranscriptionService
WHISPER_MODEL = "large"
WHISPER_BATCH_SIZE = 2  # lower batch = less activation memory during transcription
WHISPER_COMPUTE_TYPE_CUDA = "int8_float16"
WHISPER_COMPUTE_TYPE_CPU  = "int8"

# EmbeddingService
EMBEDDING_SAMPLE_RATE = 16000
EMBEDDING_MIN_DURATION = 1.0

# SpeakerMemoryService
SPEAKER_SIMILARITY_THRESHOLD = 0.75
