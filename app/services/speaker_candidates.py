"""Which known speakers an unknown voice may be. Pure: reads what it is given."""
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from app.config import POSSIBLE_MATCH_CEILING, SPEAKER_SUGGESTION_THRESHOLD
from app.services.voice_vector import voice_vector

MAX_CANDIDATES = 3


def voice_centroid(embeddings: list, durations: list | None = None) -> np.ndarray | None:
    """A speaker's voice from their segment embeddings and durations
    (voice_vector), None when there are none."""
    return voice_vector(embeddings, durations)


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


def is_possible_match(match: dict | None, ceiling: float = POSSIBLE_MATCH_CEILING) -> bool:
    """A speaker recognized below ceiling and not confirmed yet. match is a row of
    TranscriptStorageService.speaker_matches(), None when there was no match.
    The score is compared as the user sees it, like the suggestion threshold."""
    return match is not None and not match["confirmed"] and round(match["score"], 2) < ceiling


def possible_match_candidates(
    voice: np.ndarray | None,
    speaker_id: str,
    score: float,
    profiles: dict,
    names: dict,
    limit: int = MAX_CANDIDATES,
) -> list[dict]:
    """The recognized speaker first, suggested, with the similarity kept at
    recognition: their profile has this recording in it now. Then the closest
    other profiles, none of them suggested."""
    own = {"speaker_id": speaker_id, "name": names[speaker_id], "score": max(round(float(score), 2), 0.0), "suggested": True}
    others = {spk_id: emb for spk_id, emb in profiles.items() if spk_id != speaker_id}
    rest = rank_candidates(voice, others, names, limit=limit - 1) if voice is not None else []
    return [own] + [{**candidate, "suggested": False} for candidate in rest]
