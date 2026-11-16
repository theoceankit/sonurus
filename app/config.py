import os
import torch
from pathlib import Path

# Reduces CUDA memory fragmentation — must be set before any CUDA allocation.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

# Absolute: GET /health reports it, and Electron compares it with its own.
DATA_DIR = Path(os.getenv("SONORUS_DATA_DIR", ".")).resolve()
MODELS_DIR = DATA_DIR / ".models"
WHISPER_MODELS_DIR = MODELS_DIR / "whisper"
HF_MODELS_DIR = MODELS_DIR / "hf"
ALIGNMENT_MODELS_DIR = MODELS_DIR / "alignment"

# App-owned audio referenced by transcriptions.audio_file: live recordings
# (sonorus-rec-*) and copies of imported files (sonorus-import-*).
# Must not live in the OS temp dir — it is wiped on reboot on many systems.
RECORDINGS_DIR = DATA_DIR / "recordings"

# Speaker photos, one file per photo; speaker_meta.photo holds the file name.
SPEAKER_PHOTOS_DIR = DATA_DIR / "speaker_photos"

# Optional GPU download (packaged app on Linux / Windows, set by Electron):
# its folder in the app's data dir and the manifest shipped with the build.
# Unset (dev, macOS) → no download is offered.
GPU_DIR = Path(os.environ["SONORUS_GPU_DIR"]) if os.getenv("SONORUS_GPU_DIR") else None
GPU_MANIFEST = Path(os.environ["SONORUS_GPU_MANIFEST"]) if os.getenv("SONORUS_GPU_MANIFEST") else None

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

# EmbeddingService: WeSpeaker ResNet34-LM (256 values), the embedding model of
# the diarization pipeline, read from its subfolder of the diarization repo.
EMBEDDING_REPO = "pyannote/speaker-diarization-community-1"
EMBEDDING_SUBFOLDER = "embedding"
# Stored in the database next to the voices it computed: voices of another
# model cannot be compared with these (SpeakerMemoryService resets them).
EMBEDDING_MODEL_ID = "wespeaker-resnet34-lm"
EMBEDDING_SAMPLE_RATE = 16000
EMBEDDING_MIN_DURATION = 1.0

# SpeakerMemoryService. Cosine similarity at which a voice is matched to a
# profile; also the guard that keeps a far recording out of a profile
# (CommitService). Chosen on the quality tests (docs/docs/testing/quality.md):
# the same person in another recording scores 0.56-0.95 (median 0.85), other
# people at most 0.49, also across three groups of four in one memory.
SPEAKER_SIMILARITY_THRESHOLD = 0.6
# Lower than the one above: voices that reach that one are recognized by
# themselves and come up for review only as a possible match.
SPEAKER_SUGGESTION_THRESHOLD = 0.5
# A speaker recognized below this similarity is a possible match: the Editor asks
# the user to confirm them. On the quality tests 5 % of the same person's scores
# are below 0.69, so about one recognition in fourteen comes up.
POSSIBLE_MATCH_CEILING = 0.7

# Database
DB_PATH = os.getenv("DB_PATH", str(DATA_DIR / "speaker_memory.db"))
