"""Chunks without speech, as Whisper itself judges them, dropped before alignment.

WhisperX decodes every chunk the VAD passes in one generate() call, with none
of Whisper's own safeguards: no temperature fallback, no compression-ratio,
log-probability or no-speech check. Digital silence and room noise never reach
the decoder (the VAD drops them), but ring tones and music do, and Whisper
writes its stock phrases there: "Thank you.", "Продолжение следует...",
"Дякую за перегляд!". On those chunks its no-speech probability is high
(0.85–0.99 on the quality set) while the log probability is not low, so the
check here is the no-speech probability alone.

install() wraps the pipeline's CTranslate2 Whisper model: generate() is called
as WhisperX calls it, plus return_no_speech_prob=True, and the probability of
each chunk is kept in order. After transcribe() the service passes the
segments (one per chunk) to filter(), which drops those at or above THRESHOLD.
Everything else on the model passes through.
"""
from app.config import NO_SPEECH_THRESHOLD
from app.logger import get_logger

log = get_logger("NoSpeech")

# Read at every filter(); None keeps every chunk (the quality tests compare both).
THRESHOLD: float | None = NO_SPEECH_THRESHOLD


def drop(segments: list[dict], probs: list[float], threshold: float | None) -> tuple[list[dict], list[dict]]:
    """(kept, dropped): the segments whose chunk's no-speech probability is
    below `threshold`, and the others with their probability. When the
    probabilities do not match the segments one to one, everything is kept."""
    if threshold is None or not segments:
        return segments, []
    if len(probs) != len(segments):
        log.warning(f"No-speech check skipped: {len(probs)} no_speech probabilities "
                    f"for {len(segments)} chunks")
        return segments, []
    kept, dropped = [], []
    for seg, p in zip(segments, probs):
        if p >= threshold:
            dropped.append({**seg, "no_speech_prob": p})
        else:
            kept.append(seg)
    return kept, dropped


def _clock(seconds: float) -> str:
    s = int(seconds)
    h, m, s = s // 3600, s % 3600 // 60, s % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def describe(dropped: list[dict], total: int) -> str:
    chunks = "; ".join(f'{_clock(d["start"])}–{_clock(d["end"])} ({d["no_speech_prob"]:.2f}) '
                       f'"{d["text"].strip()}"' for d in dropped)
    return f"Dropped {len(dropped)} of {total} chunks as no speech: {chunks}"


class NoSpeech:
    """The pipeline's CTranslate2 Whisper model, with each chunk's no-speech probability kept."""

    def __init__(self, model):
        self._model = model
        self.probs: list[float] = []   # one per chunk decoded since reset(), in order
        self.last: list[dict] = []     # every chunk of the last filter(), with its probability

    def __getattr__(self, name):
        return getattr(self._model, name)

    def generate(self, *args, **kwargs):
        results = self._model.generate(*args, **kwargs, return_no_speech_prob=True)
        self.probs.extend(float(r.no_speech_prob) for r in results)
        return results

    def reset(self) -> None:
        self.probs = []
        self.last = []

    def filter(self, segments: list[dict]) -> list[dict]:
        threshold = THRESHOLD
        probs, self.probs = self.probs, []
        kept, dropped = drop(segments, probs, threshold)
        if len(probs) == len(segments):
            gone = {id(d) for d in kept}
            self.last = [{**s, "no_speech_prob": p, "dropped": id(s) not in gone}
                         for s, p in zip(segments, probs)]
        else:
            self.last = []
        if dropped:
            log.info(describe(dropped, len(segments)))
        return kept


def install(pipeline) -> NoSpeech:
    """Wrap the model a WhisperX pipeline decodes with (pipeline.model.model)."""
    hook = NoSpeech(pipeline.model.model)
    pipeline.model.model = hook
    return hook
