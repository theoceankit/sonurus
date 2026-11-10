"""Data for the end-to-end tests: a data directory with two recordings, their
speakers and Whisper Small with the diarization model "installed".

    PYTHONPATH=. SONORUS_DATA_DIR=<dir> .venv/bin/python tests/e2e/seed.py [full|empty]

Run before the backend starts: it reads speaker memory once at startup. Nothing
here transcribes: the models are empty repositories that only look complete, and
the queue starts paused on manual start, so a job waits until a test starts it.
"""
import math
import struct
import sys
import uuid
import wave
from pathlib import Path

import numpy as np

from app.config import ALIGNMENT_MODELS_DIR, DB_PATH, HF_MODELS_DIR, RECORDINGS_DIR, WHISPER_MODELS_DIR
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.commit_service import CommitService
from app.services.job_store import JobStore
from app.services.model_service import DIARIZATION_CATALOG, ModelService
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService

SAMPLE_RATE = 16_000
EMBEDDING_SIZE = 256


def fake_model(cache_dir: Path) -> None:
    """A Hugging Face cache folder that ModelService takes for a finished download."""
    (cache_dir / "refs").mkdir(parents=True, exist_ok=True)
    (cache_dir / "refs" / "main").write_text("e2e")


def install_models() -> None:
    models = ModelService(WHISPER_MODELS_DIR, HF_MODELS_DIR, ALIGNMENT_MODELS_DIR)
    fake_model(models._cache_dir("small"))
    for repo in DIARIZATION_CATALOG["diarize"]["hf_repos"]:
        fake_model(models._hf_cache_dir(repo))


def tone(path: Path, seconds: float) -> None:
    """A quiet tone whose loudness rises and falls, so the waveform has a shape."""
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = bytearray()
    for i in range(int(seconds * SAMPLE_RATE)):
        t = i / SAMPLE_RATE
        level = 0.1 + 0.2 * (0.5 + 0.5 * math.sin(t * 1.3))
        frames += struct.pack("<h", int(32767 * level * math.sin(2 * math.pi * 220 * t)))
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        out.writeframes(bytes(frames))


def voice(seed: int) -> np.ndarray:
    """One speaker's embedding: the same seed gives the same voice."""
    return np.random.default_rng(seed).normal(size=EMBEDDING_SIZE).astype(np.float32)


def segment(start, end, text, raw, speaker_id, seed) -> Segment:
    rng = np.random.default_rng(int(start * 100) + seed)
    emb = voice(seed) + rng.normal(scale=0.05, size=EMBEDDING_SIZE).astype(np.float32)
    return Segment(start, end, text, raw, speaker_resolved=speaker_id, embedding=emb)


def seed_full() -> None:
    memory = SpeakerMemoryService(db_path=DB_PATH)
    storage = TranscriptStorageService(db_path=DB_PATH)
    commit = CommitService(memory, storage)

    anna = memory.create_named_speaker("Anna Petrova")
    mark = memory.create_named_speaker("Mark Ellis")
    unnamed = str(uuid.uuid4())

    design = RECORDINGS_DIR / "design-review.wav"
    tone(design, 12)
    older = Transcript(audio_path=str(design), language="en", title="Design review", segments=[
        segment(0.0, 4.0, "Let us start with the new home screen.", "SPEAKER_00", anna, 1),
        segment(4.0, 8.0, "The empty state needs a clearer first step.", "SPEAKER_00", anna, 1),
        segment(8.0, 12.0, "Agreed, I will draft two options.", "SPEAKER_01", mark, 2),
    ])
    storage.save(older)
    commit.commit(older)

    weekly = RECORDINGS_DIR / "weekly-sync.wav"
    tone(weekly, 24)
    newest = Transcript(audio_path=str(weekly), language="en", title="Weekly sync", segments=[
        segment(0.0, 4.0, "Good morning, everyone.", "SPEAKER_00", anna, 1),
        segment(4.0, 8.0, "Let us go through the release plan.", "SPEAKER_00", anna, 1),
        segment(8.0, 12.0, "The installers are ready for testing.", "SPEAKER_01", mark, 2),
        segment(12.0, 16.0, "I can check them on my laptop today.", "SPEAKER_02", unnamed, 3),
        segment(16.0, 20.0, "Thanks, that helps a lot.", "SPEAKER_01", mark, 2),
        segment(20.0, 24.0, "Then we meet again on Friday.", "SPEAKER_00", anna, 1),
    ])
    storage.save(newest)
    commit.commit(newest)


def main(profile: str) -> None:
    install_models()
    JobStore(db_path=DB_PATH).set_setting("start_mode", "manual")
    if profile == "full":
        seed_full()
    elif profile != "empty":
        raise SystemExit(f"unknown profile {profile!r}: full or empty")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "full")
