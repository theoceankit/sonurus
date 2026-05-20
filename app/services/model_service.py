import os
import shutil
from asyncio import CancelledError
from pathlib import Path

import huggingface_hub

WHISPER_CATALOG = {
    "tiny":     {"hf_repo": "Systran/faster-whisper-tiny",     "size_bytes": 41_000_000},
    "base":     {"hf_repo": "Systran/faster-whisper-base",     "size_bytes": 78_000_000},
    "small":    {"hf_repo": "Systran/faster-whisper-small",    "size_bytes": 256_000_000},
    "medium":   {"hf_repo": "Systran/faster-whisper-medium",   "size_bytes": 807_000_000},
    "large-v3": {"hf_repo": "Systran/faster-whisper-large-v3", "size_bytes": 1_630_000_000},
}

# Files to download per Whisper model (matches faster-whisper's allow_patterns).
_WHISPER_ALLOW_PATTERNS = [
    "config.json",
    "preprocessor_config.json",
    "model.bin",
    "tokenizer.json",
    "vocabulary.*",
]


class ModelService:
    def __init__(self, models_dir: Path):
        self._models_dir = models_dir

    def _cache_dir(self, model_id: str) -> Path:
        hf_repo = WHISPER_CATALOG[model_id]["hf_repo"]
        return self._models_dir / ("models--" + hf_repo.replace("/", "--"))

    def is_installed(self, model_id: str) -> bool:
        if model_id not in WHISPER_CATALOG:
            raise ValueError(f"Unknown model_id: {model_id!r}")
        return (self._cache_dir(model_id) / "refs" / "main").exists()

    def list_models(self) -> list[dict]:
        return [{"id": mid, "installed": self.is_installed(mid)} for mid in WHISPER_CATALOG]

    def delete_model(self, model_id: str) -> None:
        if model_id not in WHISPER_CATALOG:
            raise ValueError(f"Unknown model_id: {model_id!r}")
        cache = self._cache_dir(model_id)
        if not cache.exists():
            raise FileNotFoundError(f"Model cache directory not found: {cache}")
        shutil.rmtree(cache)

    def download_model(self, model_id: str, cancel_event=None) -> None:
        if model_id not in WHISPER_CATALOG:
            raise ValueError(f"Unknown model_id: {model_id!r}")

        if cancel_event is not None and cancel_event.is_set():
            raise CancelledError()

        entry = WHISPER_CATALOG[model_id]
        huggingface_hub.snapshot_download(
            entry["hf_repo"],
            cache_dir=str(self._models_dir),
            token=os.getenv("HF_TOKEN"),
            allow_patterns=_WHISPER_ALLOW_PATTERNS,
        )

        if cancel_event is not None and cancel_event.is_set():
            raise CancelledError()
