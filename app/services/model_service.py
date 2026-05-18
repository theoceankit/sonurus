import os
import shutil
import threading
import time
from pathlib import Path

import huggingface_hub
from tqdm import tqdm as _BaseTqdm

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


def _build_tqdm_class(on_progress, total_bytes: int, state: dict):
    """Return a tqdm subclass that emits aggregate download progress via on_progress."""

    class _ProgressTqdm(_BaseTqdm):
        def update(self, n=1):
            super().update(n)
            with state["lock"]:
                state["downloaded"] += n
                elapsed = time.time() - state["start"]
                downloaded = state["downloaded"]
                rate = downloaded / elapsed if elapsed > 0.5 else 0
                pct = min(99.0, downloaded / total_bytes * 100) if total_bytes else 0
                eta = round((total_bytes - downloaded) / rate) if rate and total_bytes else None
                on_progress({
                    "type": "progress",
                    "pct": round(pct, 1),
                    "speed_mb": round(rate / 1_000_000, 2) if rate else None,
                    "eta_sec": eta,
                })

    return _ProgressTqdm


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

    def download_model(self, model_id: str, on_progress=None) -> None:
        if model_id not in WHISPER_CATALOG:
            raise ValueError(f"Unknown model_id: {model_id!r}")

        entry = WHISPER_CATALOG[model_id]
        state = {"downloaded": 0, "lock": threading.Lock(), "start": time.time()}
        tqdm_class = _build_tqdm_class(on_progress, entry["size_bytes"], state) if on_progress else None

        huggingface_hub.snapshot_download(
            entry["hf_repo"],
            cache_dir=str(self._models_dir),
            token=os.getenv("HF_TOKEN"),
            allow_patterns=_WHISPER_ALLOW_PATTERNS,
            tqdm_class=tqdm_class,
        )

        if on_progress:
            on_progress({"type": "done"})
