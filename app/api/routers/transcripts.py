import uuid as _uuid

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
        t = storage.load(transcript_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")
    return TranscriptResponse(
        id=t.db_id,
        audio_path=t.audio_path,
        language=t.language,
        status=t.status,
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


@router.delete("/{transcript_id}", status_code=204)
def delete_transcript(
    transcript_id: int,
    storage: TranscriptStorageService = Depends(get_storage_service),
):
    try:
        storage.load(transcript_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")
    storage.delete(transcript_id)


@router.patch("/{transcript_id}/segments/{start}/speaker", status_code=204)
def update_segment_speaker(
    transcript_id: int,
    start: float,
    body: SegmentSpeakerRequest,
    storage: TranscriptStorageService = Depends(get_storage_service),
    memory: SpeakerMemoryService = Depends(get_memory_service),
):
    try:
        t = storage.load(transcript_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")
    seg = next((s for s in t.segments if s.start == start), None)
    if seg is None:
        raise HTTPException(status_code=404, detail="Segment not found")
    try:
        _uuid.UUID(body.speaker_id, version=4)
    except ValueError:
        raise HTTPException(status_code=400, detail="speaker_id must be a valid UUID4")
    if body.speaker_id not in memory.known_speakers:
        raise HTTPException(status_code=400, detail="speaker_id not found in known speakers")
    from_spk_id = seg.speaker_final or seg.speaker_resolved or seg.speaker_raw
    storage.update_segment_speaker(transcript_id, start, seg.end, body.speaker_id)
    commit_svc = CommitService(memory, storage)
    commit_svc.commit_speaker(body.speaker_id)
    commit_svc.recompute_or_remove(from_spk_id)


@router.patch("/{transcript_id}/segments/{start}/text", status_code=204)
def update_segment_text(
    transcript_id: int,
    start: float,
    body: SegmentTextRequest,
    storage: TranscriptStorageService = Depends(get_storage_service),
):
    try:
        t = storage.load(transcript_id)
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
):
    try:
        t = storage.load(transcript_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")
    seg = next((s for s in t.segments if s.start == start), None)
    if seg is None:
        raise HTTPException(status_code=404, detail="Segment not found")
    storage.delete_segment(transcript_id, start, seg.end)


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
        t = storage.load(transcript_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")

    if has_id:
        to_uuid = body.to_speaker_id
        if to_uuid not in memory.known_speakers:
            raise HTTPException(status_code=404, detail="Speaker not found")
    else:
        to_uuid = memory._generate_new_speaker_id()
        memory.set_name(to_uuid, body.to_speaker_name)

    storage.update_segments_speaker(transcript_id, body.from_speaker_id, to_uuid)
    for seg in t.segments:
        effective = seg.speaker_final or seg.speaker_resolved or seg.speaker_raw
        if effective == body.from_speaker_id:
            seg.speaker_final = to_uuid

    commit_svc = CommitService(memory, storage)
    commit_svc.commit_speaker(to_uuid)
    commit_svc.commit_new_speakers(t)
    commit_svc.recompute_or_remove(body.from_speaker_id)


@router.post("/{transcript_id}/commit", status_code=204)
def commit_transcript(
    transcript_id: int,
    storage: TranscriptStorageService = Depends(get_storage_service),
    memory: SpeakerMemoryService = Depends(get_memory_service),
):
    try:
        t = storage.load(transcript_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")
    CommitService(memory, storage).commit(t)
