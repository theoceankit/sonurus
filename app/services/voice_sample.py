"""Choosing the segment the Speakers page plays as a speaker's voice sample."""
from typing import Callable

import numpy as np

MIN_SAMPLE_SEC = 2.0


def pick_voice_sample(segments: list[dict], profile, audio_exists: Callable[[str], bool]) -> dict | None:
    """Pick the most characteristic segment whose audio file still exists.

    segments: rows of TranscriptStorageService.speaker_segments().
    Segments of at least MIN_SAMPLE_SEC are preferred (shorter ones only if
    nothing is long enough). Among them, the one whose embedding is closest to
    the speaker's voice profile wins; without a profile or embeddings, the
    longest one. Returns None when no segment has playable audio.
    """
    playable = [s for s in segments if s["audio_file"] and audio_exists(s["audio_file"])]
    if not playable:
        return None
    long_enough = [s for s in playable if s["end"] - s["start"] >= MIN_SAMPLE_SEC] or playable

    with_emb = [s for s in long_enough if s["embedding"] is not None]
    if profile is not None and with_emb:
        p = np.asarray(profile, dtype=np.float32)
        p = p / (np.linalg.norm(p) or 1.0)

        def similarity(s):
            e = s["embedding"]
            return float(np.dot(e, p) / (np.linalg.norm(e) or 1.0))
        best = max(with_emb, key=similarity)
    else:
        best = max(long_enough, key=lambda s: s["end"] - s["start"])

    return {
        "transcript_id": best["transcription_id"],
        "audio_path": best["audio_file"],
        "start": best["start"],
        "end": best["end"],
        "text": best["text"],
    }
