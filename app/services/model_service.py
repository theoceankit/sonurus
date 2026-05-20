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

# pyannote/speaker-diarization-3.1 depends on pyannote/segmentation-3.0 for its weights.
DIARIZATION_CATALOG = {
    "diarize": {
        "hf_repos": [
            "pyannote/speaker-diarization-3.1",
            "pyannote/segmentation-3.0",
        ],
        "size_bytes": 117_000_000,
    },
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
    def __init__(self, models_dir: Path, hf_models_dir: Path | None = None):
        self._models_dir = models_dir
        self._hf_models_dir = hf_models_dir if hf_models_dir is not None else models_dir.parent / "hf"

    def _cache_dir(self, model_id: str) -> Path:
        hf_repo = WHISPER_CATALOG[model_id]["hf_repo"]
        return self._models_dir / ("models--" + hf_repo.replace("/", "--"))

    def _hf_cache_dir(self, hf_repo: str) -> Path:
        return self._hf_models_dir / ("models--" + hf_repo.replace("/", "--"))

    def is_installed(self, model_id: str) -> bool:
        if model_id in WHISPER_CATALOG:
            return (self._cache_dir(model_id) / "refs" / "main").exists()
        if model_id in DIARIZATION_CATALOG:
            return all(
                (self._hf_cache_dir(repo) / "refs" / "main").exists()
                for repo in DIARIZATION_CATALOG[model_id]["hf_repos"]
            )
        raise ValueError(f"Unknown model_id: {model_id!r}")

    def list_models(self) -> list[dict]:
        result = [{"id": mid, "installed": self.is_installed(mid)} for mid in WHISPER_CATALOG]
        result += [{"id": mid, "installed": self.is_installed(mid)} for mid in DIARIZATION_CATALOG]
        return result

    def delete_model(self, model_id: str) -> None:
        if model_id in WHISPER_CATALOG:
            cache = self._cache_dir(model_id)
            if not cache.exists():
                raise FileNotFoundError(f"Model cache directory not found: {cache}")
            shutil.rmtree(cache)
        elif model_id in DIARIZATION_CATALOG:
            if not self.is_installed(model_id):
                raise FileNotFoundError(f"Diarization model '{model_id}' is not installed")
            for repo in DIARIZATION_CATALOG[model_id]["hf_repos"]:
                cache = self._hf_cache_dir(repo)
                if cache.exists():
                    shutil.rmtree(cache)
        else:
            raise ValueError(f"Unknown model_id: {model_id!r}")

    def download_model(self, model_id: str, cancel_event=None) -> None:
        if model_id in WHISPER_CATALOG:
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
        elif model_id in DIARIZATION_CATALOG:
            for repo in DIARIZATION_CATALOG[model_id]["hf_repos"]:
                if cancel_event is not None and cancel_event.is_set():
                    raise CancelledError()
                huggingface_hub.snapshot_download(
                    repo,
                    cache_dir=str(self._hf_models_dir),
                    token=os.getenv("HF_TOKEN"),
                )
        else:
            raise ValueError(f"Unknown model_id: {model_id!r}")
