import uuid as _uuid

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity as _cos_sim
from fastapi import APIRouter, Depends, HTTPException

from app.services.transcript_storage_service import TranscriptStorageService
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.commit_service import CommitService
from app.api.dependencies import get_memory_service, get_storage_service
from app.api.schemas import (
    TranscriptListItem, TranscriptResponse, SegmentResponse,
    SegmentSpeakerRequest, SegmentTextRequest, ReassignRequest,
)

router = APIRouter(prefix="/transcripts", tags=["transcripts"])


def _effective_speaker(seg) -> str:
    return seg.speaker_final or seg.speaker_resolved or seg.speaker_raw


def _recompute_after_delete(speaker_ids, memory, storage) -> None:
    """Deleted segments must no longer contribute to speaker profiles (I4):
    recompute each affected speaker from the remaining DB segments, or drop
    unnamed speakers that have no segments left."""
    commit_svc = CommitService(memory, storage)
    for spk_id in speaker_ids:
        if spk_id:
            commit_svc.recompute_or_remove(spk_id)


@router.get("", response_model=list[TranscriptListItem])
def list_transcripts(storage: TranscriptStorageService = Depends(get_storage_service)):
    return [
        TranscriptListItem(
            id=row["id"],
            title=row["title"],
            created_at=row["created_at"],
            status=row["status"],
            speakers=row.get("speakers", []),
            section=row.get("section", ""),
            duration=row.get("duration", ""),
        )
        for row in storage.list_all()
    ]


@router.get("/{transcript_id}", response_model=TranscriptResponse)
def get_transcript(
    transcript_id: int,
    storage: TranscriptStorageService = Depends(get_storage_service),
):
    try:
        t = storage.load(transcript_id, with_embeddings=False)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")
    return TranscriptResponse(
        id=t.db_id,
        audio_path=t.audio_path,
        language=t.language,
        status=t.status,
        title=t.title,
        segments=[
            SegmentResponse(
                start=s.start,
                end=s.end,
                text=s.text,
                speaker_raw=s.speaker_raw,
                speaker_resolved=s.speaker_resolved,
                speaker_final=s.speaker_final,
            )
            for s in t.segments
        ],
    )


@router.get("/{transcript_id}/speaker-suggestions")
def get_speaker_suggestions(
    transcript_id: int,
    storage: TranscriptStorageService = Depends(get_storage_service),
    memory: SpeakerMemoryService = Depends(get_memory_service),
) -> dict:
    """For each unrecognized speaker in the transcript, return the best matching known speaker."""
    try:
        t = storage.load(transcript_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")

    recognized = {
        spk_id: memory.get_name(spk_id)
        for spk_id in memory.known_speakers
        if memory.get_name(spk_id) is not None
    }
    if not recognized:
        return {}

    embeddings_by_speaker: dict[str, list] = {}
    for seg in t.segments:
        spk_id = _effective_speaker(seg)
        if not spk_id or spk_id in recognized:
            continue
        if seg.embedding is not None:
            embeddings_by_speaker.setdefault(spk_id, []).append(seg.embedding)

    if not embeddings_by_speaker:
        return {}

    rec_ids = list(recognized.keys())
    rec_matrix = np.stack([memory.known_speakers[k] for k in rec_ids])

    result = {}
    for spk_id, embs in embeddings_by_speaker.items():
        centroid = np.mean(embs, axis=0)
        norm = float(np.linalg.norm(centroid))
        if norm > 0:
            centroid = centroid / norm
        scores = _cos_sim(centroid.reshape(1, -1), rec_matrix)[0]
        best_idx = int(np.argmax(scores))
        result[spk_id] = {
            "speaker_id": rec_ids[best_idx],
            "name": recognized[rec_ids[best_idx]],
            "score": round(float(scores[best_idx]), 2),
        }

    return result


@router.delete("/{transcript_id}", status_code=204)
def delete_transcript(
    transcript_id: int,
    storage: TranscriptStorageService = Depends(get_storage_service),
    memory: SpeakerMemoryService = Depends(get_memory_service),
):
    try:
        t = storage.load(transcript_id, with_embeddings=False)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")
    storage.delete(transcript_id)
    _recompute_after_delete({_effective_speaker(s) for s in t.segments}, memory, storage)


@router.patch("/{transcript_id}/segments/{start}/speaker", status_code=204)
def update_segment_speaker(
    transcript_id: int,
    start: float,
    body: SegmentSpeakerRequest,
    storage: TranscriptStorageService = Depends(get_storage_service),
    memory: SpeakerMemoryService = Depends(get_memory_service),
):
    if (body.speaker_id is None) == (body.speaker_name is None):
        raise HTTPException(status_code=400, detail="Provide exactly one of speaker_id or speaker_name")
    try:
        t = storage.load(transcript_id, with_embeddings=False)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")
    seg = next((s for s in t.segments if s.start == start), None)
    if seg is None:
        raise HTTPException(status_code=404, detail="Segment not found")
    if body.speaker_id is not None:
        try:
            _uuid.UUID(body.speaker_id, version=4)
        except ValueError:
            raise HTTPException(status_code=400, detail="speaker_id must be a valid UUID4")
        if body.speaker_id not in memory.known_speakers:
            raise HTTPException(status_code=400, detail="speaker_id not found in known speakers")
        to_spk_id = body.speaker_id
    else:
        to_spk_id = memory.create_named_speaker(body.speaker_name)
    from_spk_id = _effective_speaker(seg)
    storage.update_segment_speaker(transcript_id, start, seg.end, to_spk_id)
    commit_svc = CommitService(memory, storage)
    commit_svc.commit_speaker(to_spk_id)
    commit_svc.recompute_or_remove(from_spk_id)


@router.patch("/{transcript_id}/segments/{start}/text", status_code=204)
def update_segment_text(
    transcript_id: int,
    start: float,
    body: SegmentTextRequest,
    storage: TranscriptStorageService = Depends(get_storage_service),
):
    try:
        t = storage.load(transcript_id, with_embeddings=False)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")
    seg = next((s for s in t.segments if s.start == start), None)
    if seg is None:
        raise HTTPException(status_code=404, detail="Segment not found")
    storage.update_segment_text(transcript_id, start, seg.end, body.text)


@router.delete("/{transcript_id}/segments/{start}", status_code=204)
def delete_segment(
    transcript_id: int,
    start: float,
    storage: TranscriptStorageService = Depends(get_storage_service),
    memory: SpeakerMemoryService = Depends(get_memory_service),
):
    try:
        t = storage.load(transcript_id, with_embeddings=False)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")
    seg = next((s for s in t.segments if s.start == start), None)
    if seg is None:
        raise HTTPException(status_code=404, detail="Segment not found")
    storage.delete_segment(transcript_id, start, seg.end)
    _recompute_after_delete({_effective_speaker(seg)}, memory, storage)


@router.post("/{transcript_id}/reassign", status_code=204)
def reassign_speaker(
    transcript_id: int,
    body: ReassignRequest,
    storage: TranscriptStorageService = Depends(get_storage_service),
    memory: SpeakerMemoryService = Depends(get_memory_service),
):
    has_id = body.to_speaker_id is not None
    has_name = body.to_speaker_name is not None
    if has_id == has_name:
        raise HTTPException(status_code=400, detail="Provide exactly one of to_speaker_id or to_speaker_name")

    try:
        t = storage.load(transcript_id, with_embeddings=False)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")

    if not any(_effective_speaker(seg) == body.from_speaker_id for seg in t.segments):
        raise HTTPException(status_code=400, detail="from_speaker_id not found in transcript segments")

    if has_id:
        to_uuid = body.to_speaker_id
        if to_uuid not in memory.known_speakers:
            raise HTTPException(status_code=404, detail="Speaker not found")
    else:
        to_uuid = memory.create_named_speaker(body.to_speaker_name)

    storage.update_segments_speaker(transcript_id, body.from_speaker_id, to_uuid)
    for seg in t.segments:
        effective = _effective_speaker(seg)
        if effective == body.from_speaker_id:
            seg.speaker_final = to_uuid

    commit_svc = CommitService(memory, storage)
    commit_svc.commit_speaker(to_uuid)
    commit_svc.commit_new_speakers(t)
    commit_svc.recompute_or_remove(body.from_speaker_id)
