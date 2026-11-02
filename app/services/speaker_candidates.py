"""Which known speakers an unknown voice may be. Pure: reads what it is given."""
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from app.config import SPEAKER_SUGGESTION_THRESHOLD

MAX_CANDIDATES = 3


def voice_centroid(embeddings: list) -> np.ndarray | None:
    """Normalised mean of a speaker's segment embeddings, None when there are none."""
    if not embeddings:
        return None
    centroid = np.mean(embeddings, axis=0)
    norm = float(np.linalg.norm(centroid))
    return centroid / norm if norm > 0 else centroid


def rank_candidates(
    voice: np.ndarray,
    profiles: dict,
    names: dict,
    limit: int = MAX_CANDIDATES,
    threshold: float = SPEAKER_SUGGESTION_THRESHOLD,
) -> list[dict]:
    """The closest profiles to voice, most similar first, up to limit.

    score is the cosine similarity as the user sees it: two digits, not below 0.
    Only the first candidate can be suggested, when its score reaches threshold.
    """
    if not profiles:
        return []
    ids = list(profiles)
    similarities = cosine_similarity(voice.reshape(1, -1), np.stack([profiles[i] for i in ids]))[0]
    ranked = sorted(zip(ids, similarities), key=lambda item: (-round(float(item[1]), 2), names[item[0]], item[0]))

    candidates = []
    for position, (spk_id, similarity) in enumerate(ranked[:limit]):
        score = max(round(float(similarity), 2), 0.0)
        candidates.append({
            "speaker_id": spk_id,
            "name": names[spk_id],
            "score": score,
            "suggested": position == 0 and score >= threshold,
        })
    return candidates
