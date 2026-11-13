import os

from fastapi import APIRouter, Depends, HTTPException

from app.services.commit_service import CommitService
from app.services.speaker_memory_service import (
    HandleNeedsName, HandleTaken, InvalidHandle, SpeakerMemoryService, PALETTE_SIZE,
)
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.voice_sample import pick_voice_sample
from app.api.dependencies import (
    get_audio_capture_service, get_memory_service, get_storage_service, get_transcription_queue,
)
from app.api.refusals import Refusal
from app.api.schemas import (
    SpeakerResponse, RenameRequest, SpeakerUpdateRequest, HandleFormatBody, HandleSuggestionResponse,
    RefusalResponse, SpeakerDeleteResponse, SpeakerTranscriptItem, SpeakerSampleResponse,
)

router = APIRouter(prefix="/speakers", tags=["speakers"])


def _speaker_response(spk_id, memory, stats) -> SpeakerResponse:
    return SpeakerResponse(
        id=spk_id,
        name=memory.get_name(spk_id),
        handle=memory.get_handle(spk_id),
        handle_manual=memory.is_handle_manual(spk_id),
        color_index=memory.get_color_index(spk_id) or 0,
        **stats.get(spk_id, {}),
    )


def handle_refusal(exc: ValueError, memory: SpeakerMemoryService) -> Refusal:
    """The refusal for a handle error of SpeakerMemoryService."""
    if isinstance(exc, HandleTaken):
        owner = memory.get_name(exc.owner_id)
        return Refusal("handle_taken", f"@{exc.handle} is taken by {owner or 'another speaker'}.", 409)
    if isinstance(exc, HandleNeedsName):
        return Refusal("handle_needs_name", "Give the speaker a name first.")
    return Refusal("handle_invalid", "Use lowercase Latin letters, digits, dots, hyphens and underscores, "
                                     "up to 32, starting with a letter or a digit.")


HANDLE_ERRORS = (InvalidHandle, HandleTaken, HandleNeedsName)


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
    Named speakers first (by name), then unnamed ones (most recently seen first).
    Speakers that tie keep one order: the most recently seen first, then by id."""
    stats = storage.speaker_stats()
    rows = [_speaker_response(spk_id, memory, stats) for spk_id in memory.speaker_ids() | set(stats)]
    # Stable sorts, last key first.
    rows.sort(key=lambda r: r.id)
    rows.sort(key=lambda r: r.last_seen, reverse=True)
    unnamed = [r for r in rows if r.name is None]
    named = sorted((r for r in rows if r.name is not None), key=lambda r: r.name.strip().casefold())
    return named + unnamed


@router.get("/handle-suggestion", response_model=HandleSuggestionResponse)
def handle_suggestion(
    name: str,
    exclude: str | None = None,
    memory: SpeakerMemoryService = Depends(get_memory_service),
):
    """The handle a speaker named name gets now: in the handle format, numbered
    when taken. exclude: the speaker being renamed, whose own handle is free to it."""
    return HandleSuggestionResponse(handle=memory.suggest_handle(name, exclude_id=exclude))


@router.get("/handle-format", response_model=HandleFormatBody)
def get_handle_format(memory: SpeakerMemoryService = Depends(get_memory_service)):
    return HandleFormatBody(format=memory.get_handle_format())


@router.put("/handle-format", response_model=HandleFormatBody)
def set_handle_format(body: HandleFormatBody, memory: SpeakerMemoryService = Depends(get_memory_service)):
    """For speakers named from now on; handles already given stay."""
    memory.set_handle_format(body.format)
    return HandleFormatBody(format=memory.get_handle_format())


@router.patch(
    "/{speaker_id}", response_model=SpeakerResponse,
    responses={400: {"model": RefusalResponse}, 409: {"model": RefusalResponse}},
)
def update_speaker(
    speaker_id: str,
    body: SpeakerUpdateRequest,
    memory: SpeakerMemoryService = Depends(get_memory_service),
    storage: TranscriptStorageService = Depends(get_storage_service),
):
    if body.name is None and body.color_index is None and body.handle is None:
        raise HTTPException(status_code=400, detail="Provide name, color_index and/or handle")
    if body.color_index is not None and not 0 <= body.color_index < PALETTE_SIZE:
        raise HTTPException(status_code=400, detail=f"color_index must be in 0..{PALETTE_SIZE - 1}")
    stats = storage.speaker_stats()
    _require_speaker(speaker_id, memory, stats)
    # "" (or spaces) is the handle made from the name.
    handle = body.handle if body.handle is None or body.handle.strip() else ""
    try:
        # Checked before anything is written, so a refused handle changes nothing.
        if handle:
            memory.check_handle(handle, exclude_id=speaker_id)
        if handle is not None and body.name is None and not memory.get_name(speaker_id):
            raise HandleNeedsName("Only a speaker with a name has a handle")
        if body.name is not None:
            memory.set_name(speaker_id, body.name)
            memory.save_names_only()
        if handle is not None:
            memory.set_handle(speaker_id, handle or None)
    except HANDLE_ERRORS as exc:
        raise handle_refusal(exc, memory)
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
    queue=Depends(get_transcription_queue),
):
    # A running pipeline job would write the speaker's profile back when it
    # commits; wait for it (and for a capture that feeds the next job).
    # Queued jobs are fine: they resolve speakers when they run.
    if queue.is_running():
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
    return [
        SpeakerTranscriptItem(**{k: v for k, v in row.items() if k != "audio_file"},
                              has_audio=bool(row["audio_file"]) and os.path.isfile(row["audio_file"]))
        for row in rows
    ]


@router.get("/{speaker_id}/sample", response_model=SpeakerSampleResponse)
def speaker_sample(
    speaker_id: str,
    transcript_id: int | None = None,
    memory: SpeakerMemoryService = Depends(get_memory_service),
    storage: TranscriptStorageService = Depends(get_storage_service),
):
    """A segment to play as the speaker's voice: the one closest to their
    voice profile whose audio file still exists (optionally within one transcript)."""
    segments = storage.speaker_segments(speaker_id, transcript_id)
    if not segments and speaker_id not in memory.speaker_ids():
        raise HTTPException(status_code=404, detail="Speaker not found")
    sample = pick_voice_sample(segments, memory.known_speakers.get(speaker_id), os.path.isfile)
    if sample is None:
        raise HTTPException(status_code=404, detail="No audio available for this speaker")
    return SpeakerSampleResponse(**sample)
