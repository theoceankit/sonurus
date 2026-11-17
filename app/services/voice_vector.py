"""One definition of a speaker's voice, wherever embeddings are averaged."""
import numpy as np


def voice_vector(embeddings, durations=None) -> np.ndarray | None:
    """The voice of several embeddings: each scaled to length 1, weighted by
    how many seconds it speaks for, averaged and scaled to length 1. None when
    there are none.

    Used for the voice resolve() compares (diarization turns and their
    durations), a profile's per-recording centroid and a voice's candidates
    (the turns the speaker holds most of and their durations, see
    TranscriptStorageService.get_embeddings_grouped_by_transcript). Without
    durations, or when they are all zero, every embedding weighs the same.
    """
    if len(embeddings) == 0:
        return None
    embs = np.asarray(embeddings, dtype=np.float64)
    unit = embs / np.maximum(np.linalg.norm(embs, axis=1, keepdims=True), 1e-12)
    weights = np.ones(len(embs)) if durations is None else np.clip(np.asarray(durations, dtype=np.float64), 0.0, None)
    if weights.sum() <= 0:
        weights = np.ones(len(embs))
    voice = (unit * weights[:, None]).sum(axis=0) / weights.sum()
    norm = float(np.linalg.norm(voice))
    return (voice / norm if norm > 1e-12 else np.zeros_like(voice)).astype(np.float32)
