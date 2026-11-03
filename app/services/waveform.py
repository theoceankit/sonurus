"""Loudness levels of a recording, for the player's waveform.

ffmpeg decodes the audio into a pipe and the loudness of every 50 ms window is
kept in decibels, so a three-hour recording takes seconds and a few megabytes
of memory however long it is. The windows are cached next to the audio in
RECORDINGS_DIR as <audio name>.levels and go wherever the audio goes.
"""
import os
import subprocess
import threading
from pathlib import Path

import numpy as np

from app.logger import get_logger
from app.services.audio_store import _in_dir, levels_path

log = get_logger("Waveform")

WINDOWS_PER_SECOND = 20
# Silence. 16-bit audio has nothing below it.
FLOOR_DB = -96.0
# A bar's height covers this many decibels below the loud part of the recording.
RANGE_DB = 45.0
# The loud part: this percentile of the windows that are not silence.
REFERENCE_PERCENTILE = 95
_SILENCE_DB = -70.0

_SAMPLE_RATE = 8000
_WINDOW = _SAMPLE_RATE // WINDOWS_PER_SECOND
_CHUNK_WINDOWS = 4096

# The cache: a header, then one byte per window from FLOOR_DB to 0 dB.
_MAGIC = b"SNRL"
_VERSION = 1
_HEADER = len(_MAGIC) + 2
_STEP_DB = -FLOOR_DB / 255

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


class WaveformError(Exception):
    """The audio could not be read."""


def _ffmpeg() -> str:
    return "ffmpeg"


def _window_db(samples: np.ndarray) -> np.ndarray:
    windows = samples.reshape(-1, _WINDOW).astype(np.float64) / 32768
    power = np.mean(windows * windows, axis=1)
    with np.errstate(divide="ignore"):
        db = 10 * np.log10(power)
    return np.maximum(db, FLOOR_DB).astype(np.float32)


def compute_levels(audio_path: str) -> np.ndarray:
    """The loudness of every window of the audio, in dBFS. Raises
    WaveformError when ffmpeg is missing or cannot read the file."""
    cmd = [_ffmpeg(), "-v", "error", "-nostdin", "-i", audio_path,
           "-ac", "1", "-ar", str(_SAMPLE_RATE), "-f", "s16le", "-"]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as e:
        raise WaveformError(f"Could not run ffmpeg: {e}") from e
    # stderr is read on the side, so a chatty ffmpeg never blocks on it.
    errors: list[bytes] = []
    reader = threading.Thread(target=lambda: errors.append(proc.stderr.read()), daemon=True)
    reader.start()
    parts, rest = [], b""
    window_bytes = _WINDOW * 2
    try:
        while chunk := proc.stdout.read(window_bytes * _CHUNK_WINDOWS):
            data = rest + chunk
            whole = len(data) // window_bytes * window_bytes
            if whole:
                parts.append(_window_db(np.frombuffer(data[:whole], dtype="<i2")))
            rest = data[whole:]
        if rest:
            last = np.zeros(_WINDOW, dtype="<i2")
            tail = np.frombuffer(rest[: len(rest) // 2 * 2], dtype="<i2")
            last[: len(tail)] = tail
            parts.append(_window_db(last))
    finally:
        proc.stdout.close()
        code = proc.wait()
        reader.join()
    if code != 0:
        message = b"".join(errors).decode(errors="replace").strip().splitlines()
        raise WaveformError(f"ffmpeg could not read {audio_path}: {message[-1] if message else code}")
    return np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)


def _encode(db: np.ndarray) -> bytes:
    steps = np.clip(np.round((db - FLOOR_DB) / _STEP_DB), 0, 255).astype(np.uint8)
    return _MAGIC + _VERSION.to_bytes(2, "little") + steps.tobytes()


def _decode(data: bytes) -> np.ndarray | None:
    if data[: len(_MAGIC)] != _MAGIC or int.from_bytes(data[len(_MAGIC):_HEADER], "little") != _VERSION:
        return None
    steps = np.frombuffer(data[_HEADER:], dtype=np.uint8)
    return (steps.astype(np.float32) * _STEP_DB + FLOOR_DB).astype(np.float32)


def _lock(path: Path) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(str(path), threading.Lock())


def ensure_levels(audio_path: str, recordings_dir: str | Path) -> np.ndarray:
    """The levels of the audio, from the cache or worked out and cached. Audio
    outside recordings_dir is read every time: nothing is written next to the
    user's own files. Raises FileNotFoundError or WaveformError."""
    if not os.path.isfile(audio_path):
        raise FileNotFoundError(audio_path)
    if not _in_dir(audio_path, recordings_dir):
        return compute_levels(audio_path)
    cache = levels_path(audio_path)
    with _lock(cache):
        try:
            cached = _decode(cache.read_bytes())
            if cached is not None:
                return cached
        except OSError:
            pass
        db = compute_levels(audio_path)
        part = cache.with_name(cache.name + ".part")
        try:
            part.write_bytes(_encode(db))
            part.replace(cache)
        except OSError as e:
            part.unlink(missing_ok=True)
            log.warning(f"Could not cache the waveform of {audio_path}: {e}")
        return _decode(_encode(db))


def bar_levels(db: np.ndarray, bars: int, start: float, end: float) -> list[float]:
    """Heights from 0 to 1 for bars evenly over [start, end) seconds. A bar is
    the mean power of its windows; past the end of the audio is silence. The
    scale is the loud part of the whole recording, so a quiet recording fills
    the height and a clip matches the waveform it comes from."""
    if end <= start:
        raise ValueError("end must be after start")
    loud = db[db > _SILENCE_DB]
    if len(loud) == 0:
        return [0.0] * bars
    reference = float(np.percentile(loud, REFERENCE_PERCENTILE))
    power = 10 ** (db.astype(np.float64) / 10)
    edges = (start + (end - start) * np.arange(bars + 1) / bars) * WINDOWS_PER_SECOND
    bounds = np.round(edges).astype(np.int64)
    levels = []
    for i in range(bars):
        lo, hi = int(bounds[i]), int(bounds[i + 1])
        if hi <= lo:
            # Narrower than a window: the window the bar's middle falls in.
            lo = int((edges[i] + edges[i + 1]) / 2)
            hi = lo + 1
        # Windows past the end of the audio count as silence.
        mean = power[min(lo, len(db)):min(hi, len(db))].sum() / (hi - lo)
        bar_db = 10 * np.log10(mean) if mean > 0 else FLOOR_DB
        levels.append(float(np.clip((bar_db - (reference - RANGE_DB)) / RANGE_DB, 0, 1)))
    return levels
