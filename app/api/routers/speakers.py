from fastapi import APIRouter, Depends, HTTPException

from app.services.commit_service import CommitService
from app.services.speaker_memory_service import SpeakerMemoryService, PALETTE_SIZE
from app.services.transcript_storage_service import TranscriptStorageService
from app.api.dependencies import get_audio_capture_service, get_memory_service, get_storage_service
from app.api.routers import transcription
from app.api.schemas import (
    SpeakerResponse, RenameRequest, SpeakerUpdateRequest,
    SpeakerDeleteResponse, SpeakerTranscriptItem,
)

router = APIRouter(prefix="/speakers", tags=["speakers"])


def _speaker_response(spk_id, memory, stats) -> SpeakerResponse:
    return SpeakerResponse(
        id=spk_id,
        name=memory.get_name(spk_id),
        color_index=memory.get_color_index(spk_id) or 0,
        **stats.get(spk_id, {}),
    )


def _require_speaker(spk_id, memory, stats) -> None:
    """404 unless memory knows the speaker or some segment is assigned to it."""
    if spk_id not in memory.speaker_ids() and spk_id not in stats:
        raise HTTPException(status_code=404, detail="Speaker not found")


@router.get("", response_model=list[SpeakerResponse])
def list_speakers(
    memory: SpeakerMemoryService = Depends(get_memory_service),
    storage: TranscriptStorageService = Depends(get_storage_service),
):
    """Every speaker: with a voice profile, a name, or assigned segments.
    Named speakers first (by name), then unnamed ones (most recently seen first)."""
    stats = storage.speaker_stats()
    rows = [_speaker_response(spk_id, memory, stats) for spk_id in memory.speaker_ids() | set(stats)]
    unnamed = sorted((r for r in rows if r.name is None), key=lambda r: r.last_seen, reverse=True)
    named = sorted((r for r in rows if r.name is not None), key=lambda r: r.name.casefold())
    return named + unnamed


@router.patch("/{speaker_id}", response_model=SpeakerResponse)
def update_speaker(
    speaker_id: str,
    body: SpeakerUpdateRequest,
    memory: SpeakerMemoryService = Depends(get_memory_service),
    storage: TranscriptStorageService = Depends(get_storage_service),
):
    if body.name is None and body.color_index is None:
        raise HTTPException(status_code=400, detail="Provide name and/or color_index")
    if body.color_index is not None and not 0 <= body.color_index < PALETTE_SIZE:
        raise HTTPException(status_code=400, detail=f"color_index must be in 0..{PALETTE_SIZE - 1}")
    stats = storage.speaker_stats()
    _require_speaker(speaker_id, memory, stats)
    if body.name is not None:
        memory.set_name(speaker_id, body.name)
        memory.save_names_only()
    if body.color_index is not None:
        memory.set_color(speaker_id, body.color_index)
    return _speaker_response(speaker_id, memory, stats)


@router.post("/{speaker_id}/rename", status_code=204)
def rename_speaker(
    speaker_id: str,
    body: RenameRequest,
    memory: SpeakerMemoryService = Depends(get_memory_service),
):
    if speaker_id not in memory.known_speakers:
        raise HTTPException(status_code=404, detail="Speaker not found")
    memory.set_name(speaker_id, body.name)
    memory.save_names_only()


@router.delete("/{speaker_id}", response_model=SpeakerDeleteResponse)
def delete_speaker(
    speaker_id: str,
    memory: SpeakerMemoryService = Depends(get_memory_service),
    storage: TranscriptStorageService = Depends(get_storage_service),
    capture=Depends(get_audio_capture_service),
):
    # A running pipeline job would write the speaker's profile back when it
    # commits; wait for it (and for a capture that feeds the next job).
    if transcription._jobs:
        raise HTTPException(status_code=409, detail="A transcription is in progress")
    if capture.has_active_jobs():
        raise HTTPException(status_code=409, detail="A recording is in progress")
    _require_speaker(speaker_id, memory, storage.speaker_stats())
    return SpeakerDeleteResponse(**CommitService(memory, storage).delete_speaker(speaker_id))


@router.get("/{speaker_id}/transcripts", response_model=list[SpeakerTranscriptItem])
def speaker_transcripts(
    speaker_id: str,
    memory: SpeakerMemoryService = Depends(get_memory_service),
    storage: TranscriptStorageService = Depends(get_storage_service),
):
    rows = storage.transcripts_for_speaker(speaker_id)
    if not rows and speaker_id not in memory.speaker_ids():
        raise HTTPException(status_code=404, detail="Speaker not found")
    return [SpeakerTranscriptItem(**row) for row in rows]
