import fnmatch
import os
import shutil
import threading
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


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------

def _matches_allow_patterns(filename: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(filename, p) for p in patterns)


def _count_cache_bytes(dirs: list[Path]) -> int:
    """Sum bytes of all real files (blobs + incomplete temp files) in the given dirs.

    Skips symlinks so the snapshots/ directory doesn't double-count blobs.
    Uses try/except per file to survive race conditions during active downloads.
    """
    total = 0
    for d in dirs:
        if not d.exists():
            continue
        for f in d.rglob("*"):
            try:
                if f.is_file() and not f.is_symlink():
                    total += f.stat().st_size
            except OSError:
                pass
    return total


def _poll_and_emit(
    dirs: list[Path],
    total_bytes: int,
    on_progress,
    stop_event: threading.Event,
    cancel_event: threading.Event,
    interval: float = 1.0,
) -> None:
    """Background thread: poll filesystem bytes and push progress events."""
    while not stop_event.is_set() and not cancel_event.is_set():
        downloaded = _count_cache_bytes(dirs)
        pct = min(99.0, downloaded / total_bytes * 100) if total_bytes > 0 else 0.0
        on_progress({"type": "progress", "pct": round(pct, 1)})
        stop_event.wait(interval)


# ---------------------------------------------------------------------------
# ModelService
# ---------------------------------------------------------------------------

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

    def _get_total_bytes(self, model_id: str) -> int:
        """Query HF Hub API for the total expected download size.

        Falls back to the catalog's size_bytes estimate if the API call fails.
        For Whisper models, only counts files matching _WHISPER_ALLOW_PATTERNS.
        """
        try:
            if model_id in WHISPER_CATALOG:
                entry = WHISPER_CATALOG[model_id]
                info = huggingface_hub.model_info(
                    entry["hf_repo"],
                    files_metadata=True,
                    token=os.getenv("HF_TOKEN"),
                )
                return sum(
                    s.size for s in info.siblings
                    if s.size and _matches_allow_patterns(s.rfilename, _WHISPER_ALLOW_PATTERNS)
                )
            if model_id in DIARIZATION_CATALOG:
                total = 0
                for repo in DIARIZATION_CATALOG[model_id]["hf_repos"]:
                    info = huggingface_hub.model_info(
                        repo,
                        files_metadata=True,
                        token=os.getenv("HF_TOKEN"),
                    )
                    total += sum(s.size for s in info.siblings if s.size)
                return total
        except Exception:
            pass
        # Fallback to catalog estimate
        if model_id in WHISPER_CATALOG:
            return WHISPER_CATALOG[model_id]["size_bytes"]
        if model_id in DIARIZATION_CATALOG:
            return DIARIZATION_CATALOG[model_id]["size_bytes"]
        return 0

    def _start_poller(
        self,
        dirs: list[Path],
        model_id: str,
        on_progress,
        cancel_event,
    ) -> tuple[threading.Event | None, threading.Thread | None]:
        """Start a background progress-polling thread. Returns (stop_event, thread) or (None, None)."""
        if on_progress is None:
            return None, None
        total_bytes = self._get_total_bytes(model_id)
        stop = threading.Event()
        _cancel = cancel_event if cancel_event is not None else threading.Event()
        t = threading.Thread(
            target=_poll_and_emit,
            args=(dirs, total_bytes, on_progress, stop, _cancel),
            daemon=True,
        )
        t.start()
        return stop, t

    @staticmethod
    def _stop_poller(stop: threading.Event | None, t: threading.Thread | None) -> None:
        if stop is not None:
            stop.set()
        if t is not None:
            t.join(timeout=2)

    def download_model(self, model_id: str, cancel_event=None, on_progress=None) -> None:
        if model_id in WHISPER_CATALOG:
            if cancel_event is not None and cancel_event.is_set():
                raise CancelledError()

            stop, poller = self._start_poller(
                dirs=[self._cache_dir(model_id)],
                model_id=model_id,
                on_progress=on_progress,
                cancel_event=cancel_event,
            )
            try:
                huggingface_hub.snapshot_download(
                    WHISPER_CATALOG[model_id]["hf_repo"],
                    cache_dir=str(self._models_dir),
                    token=os.getenv("HF_TOKEN"),
                    allow_patterns=_WHISPER_ALLOW_PATTERNS,
                )
            finally:
                self._stop_poller(stop, poller)

            if cancel_event is not None and cancel_event.is_set():
                raise CancelledError()

        elif model_id in DIARIZATION_CATALOG:
            dirs = [self._hf_cache_dir(repo) for repo in DIARIZATION_CATALOG[model_id]["hf_repos"]]
            stop, poller = self._start_poller(
                dirs=dirs,
                model_id=model_id,
                on_progress=on_progress,
                cancel_event=cancel_event,
            )
            try:
                for repo in DIARIZATION_CATALOG[model_id]["hf_repos"]:
                    if cancel_event is not None and cancel_event.is_set():
                        raise CancelledError()
                    huggingface_hub.snapshot_download(
                        repo,
                        cache_dir=str(self._hf_models_dir),
                        token=os.getenv("HF_TOKEN"),
                    )
            finally:
                self._stop_poller(stop, poller)

        else:
            raise ValueError(f"Unknown model_id: {model_id!r}")
