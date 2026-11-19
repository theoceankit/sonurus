"""The language of a recording, detected from its speech.

WhisperX detects the language from the first 30 s of the file, silence, ring
tones and music included, and takes the most likely one however unsure. Here
the language is detected from the speech the voice activity detection of the
same transcribe() call found: the first 30 s of speech, and when Whisper is
not confident there, also 30 s from the middle and from the end of the
speech, with the probabilities averaged over the windows (weighted by their
seconds of speech).

install() hooks into a WhisperX pipeline: it records what the VAD model's
merge_chunks() returns and replaces the pipeline's detect_language(), which
transcribe() calls after it when no language was given.
"""
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from app.config import LANGUAGE_CONFIDENT, LANGUAGE_MAX_WINDOWS, LANGUAGE_WINDOW_S
from app.logger import get_logger

log = get_logger("LanguageDetection")

SAMPLE_RATE = 16000
CONFIDENT = LANGUAGE_CONFIDENT

Span = tuple[float, float]


@dataclass(frozen=True)
class Detection:
    language: str
    probability: float  # of the language, averaged over the windows used
    speech_s: float     # seconds of speech the windows held
    windows: int
    start: float        # where in the recording the speech used starts and ends
    end: float


def speech_spans(chunks) -> list[Span]:
    """Speech intervals (seconds) in the chunks merge_chunks() returned."""
    return [(float(s), float(e)) for chunk in chunks or [] for s, e in chunk["segments"]]


def _cut(spans: list[Span], start: float, end: float) -> list[Span]:
    """The speech between `start` and `end` seconds of speech, as intervals of the recording."""
    out, t = [], 0.0
    for s, e in spans:
        d = e - s
        lo, hi = max(start, t), min(end, t + d)
        if hi > lo:
            out.append((s + lo - t, s + hi - t))
        t += d
        if t >= end:
            break
    return out


def speech_windows(spans: list[Span], window: float = LANGUAGE_WINDOW_S,
                   count: int = LANGUAGE_MAX_WINDOWS) -> list[list[Span]]:
    """Up to `count` windows of up to `window` seconds of speech: the first, then
    one around the middle of the speech and one at its end. A later window
    starts no earlier than the previous one ended; one left empty is dropped."""
    total = sum(e - s for s, e in spans)
    if total <= 0:
        return []
    starts = [0.0]
    if count >= 3:
        starts.append(total / 2 - window / 2)
    if count >= 2:
        starts.append(total - window)
    windows, prev_end = [], 0.0
    for i, start in enumerate(starts):
        lo = start if i == 0 else max(start, prev_end)
        hi = min(lo + window, total)
        if hi <= lo:
            continue
        windows.append(_cut(spans, lo, hi))
        prev_end = hi
    return windows


def _seconds(window: list[Span]) -> float:
    return sum(e - s for s, e in window)


def choose(windows: list[list[Span]], probs: Callable[[list[Span]], dict[str, float]],
           confident: float = CONFIDENT) -> Detection:
    """The most likely language: from the first window when its best language
    reaches `confident`, otherwise averaged over all windows."""
    used = [windows[0]]
    results = [probs(windows[0])]
    if max(results[0].values()) < confident:
        for w in windows[1:]:
            used.append(w)
            results.append(probs(w))
    weights = [_seconds(w) for w in used]
    total = sum(weights)
    avg: dict[str, float] = {}
    for p, wt in zip(results, weights):
        for lang, v in p.items():
            avg[lang] = avg.get(lang, 0.0) + v * wt / total
    language = max(avg, key=avg.get)
    return Detection(language=language, probability=avg[language], speech_s=round(total, 3),
                     windows=len(used), start=used[0][0][0], end=max(w[-1][1] for w in used))


def _clock(seconds: float) -> str:
    s = int(seconds)
    h, m, s = s // 3600, s % 3600 // 60, s % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def describe(det: Detection) -> str:
    windows = "window" if det.windows == 1 else "windows"
    return (f"Language: {det.language} ({det.probability:.2f}) from {det.speech_s:.0f} s of speech "
            f"in {det.windows} {windows}, speech {_clock(det.start)}–{_clock(det.end)}")


def whisper_probs(pipeline) -> Callable[[np.ndarray, list[Span]], dict[str, float]]:
    """Probability of every language Whisper knows, for one window of speech:
    the window's audio glued together and padded to 30 s, as WhisperX pads the
    start of the file."""
    from whisperx.audio import N_SAMPLES, log_mel_spectrogram

    def probs(audio: np.ndarray, window: list[Span]) -> dict[str, float]:
        piece = np.concatenate([audio[int(s * SAMPLE_RATE):int(e * SAMPLE_RATE)] for s, e in window])
        piece = piece[:N_SAMPLES]
        n_mels = pipeline.model.feat_kwargs.get("feature_size") or 80
        mel = log_mel_spectrogram(piece, n_mels=n_mels, padding=N_SAMPLES - piece.shape[0])
        encoded = pipeline.model.encode(mel)
        return {token[2:-2]: float(p) for token, p in pipeline.model.model.detect_language(encoded)[0]}

    return probs


class SpeechLanguage:
    """detect_language() of one pipeline, from the speech of its last VAD pass."""

    def __init__(self, pipeline, probs=None):
        self.original = pipeline.detect_language  # WhisperX's own: the first 30 s of the file
        self._probs = probs
        self._pipeline = pipeline
        self.chunks = None     # what merge_chunks() returned in the running transcribe()
        self.last: Detection | None = None

    def record(self, chunks):
        self.chunks = chunks
        return chunks

    def detect(self, audio: np.ndarray) -> str:
        chunks, self.chunks = self.chunks, None
        self.last = None
        windows = speech_windows(speech_spans(chunks))
        if not windows:
            log.info("Language: no speech found, detecting from the first 30 s of the file")
            return self.original(audio)
        probs = self._probs or whisper_probs(self._pipeline)
        self.last = choose(windows, lambda w: probs(audio, w))
        log.info(describe(self.last))
        return self.last.language


def install(pipeline, probs=None) -> SpeechLanguage:
    """Hook the detection into a WhisperX pipeline. `probs(audio, window)` gives
    the probability of each language for a window (default: Whisper's)."""
    hook = SpeechLanguage(pipeline, probs)
    merge = pipeline.vad_model.merge_chunks
    # transcribe() reads merge_chunks from the VAD model instance, so an
    # attribute on the instance takes the place of its static method.
    pipeline.vad_model.merge_chunks = lambda *a, **k: hook.record(merge(*a, **k))
    pipeline.detect_language = hook.detect
    return hook
