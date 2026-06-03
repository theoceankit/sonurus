import fnmatch
import os
import shutil
import threading
from asyncio import CancelledError
from pathlib import Path

import huggingface_hub

WHISPER_CATALOG = {
    "tiny":     {"hf_repo": "Systran/faster-whisper-tiny",     "size_bytes": 41_000_000,    "name": "Whisper Tiny",     "size": "39 MB",   "speed": "~10× realtime", "acc": "Low",               "recommended": False, "kind": "whisper"},
    "base":     {"hf_repo": "Systran/faster-whisper-base",     "size_bytes": 78_000_000,    "name": "Whisper Base",     "size": "74 MB",   "speed": "~7× realtime",  "acc": "Fair",              "recommended": False, "kind": "whisper"},
    "small":    {"hf_repo": "Systran/faster-whisper-small",    "size_bytes": 256_000_000,   "name": "Whisper Small",    "size": "244 MB",  "speed": "~4× realtime",  "acc": "Good",              "recommended": False, "kind": "whisper"},
    "medium":   {"hf_repo": "Systran/faster-whisper-medium",   "size_bytes": 807_000_000,   "name": "Whisper Medium",   "size": "769 MB",  "speed": "~2× realtime",  "acc": "Very good",         "recommended": False, "kind": "whisper"},
    "large-v3": {"hf_repo": "Systran/faster-whisper-large-v3", "size_bytes": 1_630_000_000, "name": "Whisper Large v3", "size": "1.55 GB", "speed": "~1× realtime",  "acc": "Best",              "recommended": True,  "kind": "whisper"},
}

# whisperx uses pyannote/speaker-diarization-community-1 by default (single repo
# with segmentation and embedding stored as subfolders — no separate sub-repos).
# pyannote/embedding is downloaded separately for EmbeddingService.
DIARIZATION_CATALOG = {
    "diarize": {
        "hf_repos": [
            "pyannote/speaker-diarization-community-1",
            "pyannote/embedding",
        ],
        "size_bytes": 300_000_000,
        "name": "Diarization · v2", "size": "112 MB", "speed": "—", "acc": "Speaker separation", "recommended": False, "kind": "diarization",
    },
}

ALIGNMENT_CATALOG = {
    "ru": {"hf_repo": "jonatasgrosman/wav2vec2-large-xlsr-53-russian",       "size_bytes": 1_260_000_000},
    "zh": {"hf_repo": "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn", "size_bytes": 1_260_000_000},
    "ja": {"hf_repo": "jonatasgrosman/wav2vec2-large-xlsr-53-japanese",      "size_bytes": 1_260_000_000},
    "ko": {"hf_repo": "kresnik/wav2vec2-large-xlsr-korean",                  "size_bytes": 1_260_000_000},
    "uk": {"hf_repo": "Yehor/wav2vec2-xls-r-300m-uk-with-small-lm",         "size_bytes": 1_260_000_000},
    "pt": {"hf_repo": "jonatasgrosman/wav2vec2-large-xlsr-53-portuguese",    "size_bytes": 1_260_000_000},
    "ar": {"hf_repo": "jonatasgrosman/wav2vec2-large-xlsr-53-arabic",        "size_bytes": 1_260_000_000},
    "nl": {"hf_repo": "jonatasgrosman/wav2vec2-large-xlsr-53-dutch",         "size_bytes": 1_260_000_000},
    "pl": {"hf_repo": "jonatasgrosman/wav2vec2-large-xlsr-53-polish",        "size_bytes": 1_260_000_000},
    "hi": {"hf_repo": "theainerd/Wav2Vec2-large-xlsr-hindi",                 "size_bytes": 1_260_000_000},
    "cs": {"hf_repo": "comodoro/wav2vec2-xls-r-300m-cs-250",                "size_bytes": 300_000_000},
    "tr": {"hf_repo": "mpoyraz/wav2vec2-xls-r-300m-cv7-turkish",            "size_bytes": 300_000_000},
    "hu": {"hf_repo": "jonatasgrosman/wav2vec2-large-xlsr-53-hungarian",     "size_bytes": 1_260_000_000},
    "fi": {"hf_repo": "jonatasgrosman/wav2vec2-large-xlsr-53-finnish",       "size_bytes": 1_260_000_000},
    "fa": {"hf_repo": "jonatasgrosman/wav2vec2-large-xlsr-53-persian",       "size_bytes": 1_260_000_000},
    "el": {"hf_repo": "jonatasgrosman/wav2vec2-large-xlsr-53-greek",         "size_bytes": 1_260_000_000},
    "da": {"hf_repo": "saattrupdan/wav2vec2-xls-r-300m-ftspeech",           "size_bytes": 300_000_000},
    "he": {"hf_repo": "imvladikon/wav2vec2-xls-r-300m-hebrew",              "size_bytes": 300_000_000},
    "vi": {"hf_repo": "nguyenvulebinh/wav2vec2-base-vi-vlsp2020",            "size_bytes": 360_000_000},
    "ur": {"hf_repo": "kingabzpro/wav2vec2-large-xls-r-300m-Urdu",          "size_bytes": 300_000_000},
    "te": {"hf_repo": "anuragshas/wav2vec2-large-xlsr-53-telugu",            "size_bytes": 1_260_000_000},
    "ca": {"hf_repo": "softcatala/wav2vec2-large-xlsr-catala",               "size_bytes": 1_260_000_000},
    "ml": {"hf_repo": "gvs/wav2vec2-large-xlsr-malayalam",                   "size_bytes": 1_260_000_000},
    "no": {"hf_repo": "NbAiLab/nb-wav2vec2-1b-bokmaal-v2",                  "size_bytes": 1_260_000_000},
    "nn": {"hf_repo": "NbAiLab/nb-wav2vec2-1b-nynorsk",                     "size_bytes": 1_260_000_000},
    "sk": {"hf_repo": "comodoro/wav2vec2-xls-r-300m-sk-cv8",               "size_bytes": 300_000_000},
    "sl": {"hf_repo": "anton-l/wav2vec2-large-xlsr-53-slovenian",            "size_bytes": 1_260_000_000},
    "hr": {"hf_repo": "classla/wav2vec2-xls-r-parlaspeech-hr",              "size_bytes": 1_260_000_000},
    "ro": {"hf_repo": "gigant/romanian-wav2vec2",                            "size_bytes": 1_260_000_000},
    "eu": {"hf_repo": "stefan-it/wav2vec2-large-xlsr-53-basque",             "size_bytes": 1_260_000_000},
    "gl": {"hf_repo": "ifrz/wav2vec2-large-xlsr-galician",                  "size_bytes": 1_260_000_000},
    "ka": {"hf_repo": "xsway/wav2vec2-large-xlsr-georgian",                  "size_bytes": 1_260_000_000},
    "lv": {"hf_repo": "jimregan/wav2vec2-large-xlsr-latvian-cv",             "size_bytes": 1_260_000_000},
    "tl": {"hf_repo": "Khalsuu/filipino-wav2vec2-l-xls-r-300m-official",    "size_bytes": 300_000_000},
    "sv": {"hf_repo": "KBLab/wav2vec2-large-voxrex-swedish",                "size_bytes": 1_260_000_000},
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
    get_total_bytes,
    on_progress,
    stop_event: threading.Event,
    cancel_event: threading.Event,
    interval: float = 1.0,
) -> None:
    """Background thread: poll filesystem bytes and push progress events.

    get_total_bytes is called once on first tick (inside this thread) to avoid
    blocking the caller with network I/O before the download even starts.
    """
    total_bytes = get_total_bytes()
    while not stop_event.is_set() and not cancel_event.is_set():
        downloaded = _count_cache_bytes(dirs)
        pct = min(99.0, downloaded / total_bytes * 100) if total_bytes > 0 else 0.0
        on_progress({"type": "progress", "pct": round(pct, 1)})
        stop_event.wait(interval)


# ---------------------------------------------------------------------------
# ModelService
# ---------------------------------------------------------------------------

class ModelService:
    def __init__(self, models_dir: Path, hf_models_dir: Path | None = None, alignment_models_dir: Path | None = None):
        self._models_dir = models_dir
        self._hf_models_dir = hf_models_dir if hf_models_dir is not None else models_dir.parent / "hf"
        self._alignment_models_dir = alignment_models_dir if alignment_models_dir is not None else models_dir.parent / "alignment"

    def _cache_dir(self, model_id: str) -> Path:
        hf_repo = WHISPER_CATALOG[model_id]["hf_repo"]
        return self._models_dir / ("models--" + hf_repo.replace("/", "--"))

    def _hf_cache_dir(self, hf_repo: str) -> Path:
        return self._hf_models_dir / ("models--" + hf_repo.replace("/", "--"))

    def _alignment_dir(self, hf_repo: str) -> Path:
        return self._alignment_models_dir / ("models--" + hf_repo.replace("/", "--"))

    def is_installed(self, model_id: str) -> bool:
        if model_id in WHISPER_CATALOG:
            return (self._cache_dir(model_id) / "refs" / "main").exists()
        if model_id in DIARIZATION_CATALOG:
            return all(
                (self._hf_cache_dir(repo) / "refs" / "main").exists()
                for repo in DIARIZATION_CATALOG[model_id]["hf_repos"]
            )
        if model_id in ALIGNMENT_CATALOG:
            hf_repo = ALIGNMENT_CATALOG[model_id]["hf_repo"]
            return (self._alignment_dir(hf_repo) / "refs" / "main").exists()
        raise ValueError(f"Unknown model_id: {model_id!r}")

    def list_models(self) -> list[dict]:
        result = []
        for mid, entry in WHISPER_CATALOG.items():
            result.append({
                "id": mid, "installed": self.is_installed(mid),
                "name": entry["name"], "size": entry["size"],
                "speed": entry["speed"], "acc": entry["acc"],
                "recommended": entry["recommended"], "kind": entry["kind"],
            })
        for mid, entry in DIARIZATION_CATALOG.items():
            result.append({
                "id": mid, "installed": self.is_installed(mid),
                "name": entry["name"], "size": entry["size"],
                "speed": entry["speed"], "acc": entry["acc"],
                "recommended": entry["recommended"], "kind": entry["kind"],
            })
        for mid in ALIGNMENT_CATALOG:
            result.append({"id": mid, "installed": self.is_installed(mid), "kind": "alignment"})
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
        elif model_id in ALIGNMENT_CATALOG:
            hf_repo = ALIGNMENT_CATALOG[model_id]["hf_repo"]
            cache = self._alignment_dir(hf_repo)
            if not cache.exists():
                raise FileNotFoundError(f"Alignment model '{model_id}' is not installed")
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
            if model_id in ALIGNMENT_CATALOG:
                hf_repo = ALIGNMENT_CATALOG[model_id]["hf_repo"]
                info = huggingface_hub.model_info(hf_repo, files_metadata=True, token=os.getenv("HF_TOKEN"))
                return sum(s.size for s in info.siblings if s.size)
        except Exception:
            pass
        if model_id in DIARIZATION_CATALOG:
            total = 0
            for repo in DIARIZATION_CATALOG[model_id]["hf_repos"]:
                try:
                    info = huggingface_hub.model_info(
                        repo,
                        files_metadata=True,
                        token=os.getenv("HF_TOKEN"),
                    )
                    total += sum(s.size for s in info.siblings if s.size)
                except Exception:
                    break
            if total > 0:
                return total
        # Fallback to catalog estimate
        if model_id in WHISPER_CATALOG:
            return WHISPER_CATALOG[model_id]["size_bytes"]
        if model_id in DIARIZATION_CATALOG:
            return DIARIZATION_CATALOG[model_id]["size_bytes"]
        if model_id in ALIGNMENT_CATALOG:
            return ALIGNMENT_CATALOG[model_id]["size_bytes"]
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
        stop = threading.Event()
        _cancel = cancel_event if cancel_event is not None else threading.Event()
        t = threading.Thread(
            target=_poll_and_emit,
            args=(dirs, lambda: self._get_total_bytes(model_id), on_progress, stop, _cancel),
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

    def download_model(self, model_id: str, cancel_event=None, on_progress=None, hf_token: str | None = None) -> None:
        token = hf_token or os.getenv("HF_TOKEN")

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
                    token=token,
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
                        token=token,
                    )
            finally:
                self._stop_poller(stop, poller)

        elif model_id in ALIGNMENT_CATALOG:
            hf_repo = ALIGNMENT_CATALOG[model_id]["hf_repo"]
            dirs = [self._alignment_dir(hf_repo)]
            stop, poller = self._start_poller(
                dirs=dirs,
                model_id=model_id,
                on_progress=on_progress,
                cancel_event=cancel_event,
            )
            try:
                if cancel_event is not None and cancel_event.is_set():
                    raise CancelledError()
                huggingface_hub.snapshot_download(
                    hf_repo,
                    cache_dir=str(self._alignment_models_dir),
                    token=token,
                )
            finally:
                self._stop_poller(stop, poller)
            if cancel_event is not None and cancel_event.is_set():
                raise CancelledError()

        else:
            raise ValueError(f"Unknown model_id: {model_id!r}")
