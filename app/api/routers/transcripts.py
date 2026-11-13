import os
import uuid as _uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

import app.config as config
from app.logger import get_logger
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.speaker_memory_service import PALETTE_SIZE, SpeakerMemoryService
from app.services.commit_service import CommitService
from app.api.dependencies import get_memory_service, get_storage_service
from app.api.routers.speakers import HANDLE_ERRORS, handle_refusal
from app.models.segment import UNASSIGNED
from app.api.schemas import (
    TranscriptListItem, TranscriptResponse, SegmentResponse, TranscriptUpdateRequest,
    SegmentTextRequest, SpeakerCandidate, UnknownSpeakerCandidates, VoiceClip, SpeakerAssignmentRequest,
    SpeakerAssignmentResponse, SpeakerAssignmentUndoRequest, WaveformResponse, RefusalResponse,
)
from app.services.audio_store import discard_levels
from app.services.speaker_candidates import rank_candidates, voice_centroid
from app.services.voice_sample import pick_voice_sample
from app.services.waveform import WINDOWS_PER_SECOND, WaveformError, bar_levels, ensure_levels

router = APIRouter(prefix="/transcripts", tags=["transcripts"])

log = get_logger("TranscriptsAPI")


def _effective_speaker(seg) -> str:
    if seg.unassigned:
        return UNASSIGNED
    return seg.speaker_final or seg.speaker_resolved or seg.speaker_raw


def _recompute_after_delete(speaker_ids, memory, storage) -> None:
    """Deleted segments must no longer contribute to speaker profiles (I4):
    recompute each affected speaker from the remaining DB segments, or drop
    unnamed speakers that have no segments left."""
    commit_svc = CommitService(memory, storage)
    for spk_id in speaker_ids:
        if spk_id:
            commit_svc.recompute_or_remove(spk_id)


def _check_new_speaker_color(color_index: int | None, creates_speaker: bool) -> None:
    """color_index is only meaningful for a speaker created by name, and must be in the palette."""
    if color_index is None:
        return
    if not creates_speaker:
        raise HTTPException(status_code=400, detail="color_index is only allowed when creating a speaker by name")
    if not 0 <= color_index < PALETTE_SIZE:
        raise HTTPException(status_code=400, detail=f"color_index must be in 0..{PALETTE_SIZE - 1}")


def _create_speaker(memory: SpeakerMemoryService, name: str, color_index: int | None, handle: str | None) -> str:
    try:
        spk_id = memory.create_named_speaker(name, handle=handle)
    except HANDLE_ERRORS as exc:
        raise handle_refusal(exc, memory)
    if color_index is not None:
        memory.set_color(spk_id, color_index)
    return spk_id


def _check_uuid(value: str, field: str) -> None:
    try:
        _uuid.UUID(value, version=4)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field} must be a valid UUID4")


def _check_known_speaker(memory: SpeakerMemoryService, speaker_id: str) -> None:
    _check_uuid(speaker_id, "speaker_id")
    # A named speaker may have no voice profile yet (its segments were too short)
    if speaker_id not in memory.speaker_ids():
        raise HTTPException(status_code=400, detail="speaker_id not found in known speakers")


def _delete_owned_recording(audio_file: str, storage: TranscriptStorageService) -> None:
    """Delete a live recording once no transcript references it.

    Only files directly owned by the app (inside RECORDINGS_DIR) are removed;
    imported audio elsewhere on disk is never touched. A symlink is removed
    as a link, its target is kept.
    """
    if not audio_file or storage.count_by_audio_file(audio_file) > 0:
        return
    path = Path(audio_file)
    recordings = Path(config.RECORDINGS_DIR).resolve()
    # Resolve the parent only, so a symlink itself is judged by where it lives.
    parent = Path(os.path.abspath(path.parent)).resolve()
    if parent != recordings and recordings not in parent.parents:
        return
    try:
        (parent / path.name).unlink()
        log.info(f"Deleted recording {audio_file}")
    except FileNotFoundError:
        pass
    except OSError as e:
        log.warning(f"Could not delete recording {audio_file}: {e}")
    discard_levels(parent / path.name)


@router.get("", response_model=list[TranscriptListItem])
def list_transcripts(storage: TranscriptStorageService = Depends(get_storage_service)):
    return [
        TranscriptListItem(
            id=row["id"],
            title=row["title"],
            created_at=row["created_at"],
            status=row["status"],
            opened=row["opened"],
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
                unassigned=s.unassigned,
            )
            for s in t.segments
        ],
    )


@router.get(
    "/{transcript_id}/audio",
    response_class=FileResponse,
    responses={200: {"content": {"audio/*": {}}}, 404: {"description": "No such transcript, or its audio file is gone"}},
)
def get_transcript_audio(
    transcript_id: int,
    storage: TranscriptStorageService = Depends(get_storage_service),
):
    """The audio file of a recording, with Range requests for seeking. The path
    comes from the database only."""
    try:
        audio_path = storage.load(transcript_id, with_embeddings=False).audio_path
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")
    if not audio_path or not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(audio_path)


@router.get(
    "/{transcript_id}/waveform",
    response_model=WaveformResponse,
    responses={
        404: {"description": "No such transcript, or its audio file is gone"},
        500: {"description": "The audio could not be read"},
    },
)
def get_transcript_waveform(
    transcript_id: int,
    bars: int = Query(ge=1, le=2000),
    start: float = Query(0, ge=0),
    end: float | None = Query(None, gt=0, description="Seconds; the end of the audio by default"),
    storage: TranscriptStorageService = Depends(get_storage_service),
):
    """Heights for the player's waveform: bars evenly over [start, end) of the
    recording, on the scale of the whole recording. The loudness is worked out
    with ffmpeg on the first request (or after transcription) and cached next to
    the audio."""
    if end is not None and end <= start:
        raise HTTPException(status_code=422, detail="end must be after start")
    try:
        audio_path = storage.load(transcript_id, with_embeddings=False).audio_path
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")
    if not audio_path or not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    try:
        db = ensure_levels(audio_path, config.RECORDINGS_DIR)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Audio file not found")
    except WaveformError as e:
        log.warning(f"Waveform of transcript {transcript_id}: {e}")
        raise HTTPException(status_code=500, detail="Could not read the audio")
    if end is None:
        end = max(len(db) / WINDOWS_PER_SECOND, start + 1 / WINDOWS_PER_SECOND)
    return WaveformResponse(levels=bar_levels(db, bars, start, end))


@router.get("/{transcript_id}/speaker-candidates", response_model=dict[str, UnknownSpeakerCandidates])
def get_speaker_candidates(
    transcript_id: int,
    storage: TranscriptStorageService = Depends(get_storage_service),
    memory: SpeakerMemoryService = Depends(get_memory_service),
):
    """For each speaker without a name in the transcript: the known speakers
    with the closest voice and a clip to hear it. Reads speaker memory only."""
    try:
        t = storage.load(transcript_id, with_embeddings=False)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")

    names = {
        spk_id: memory.get_name(spk_id)
        for spk_id in memory.known_speakers
        if memory.get_name(spk_id) is not None
    }
    profiles = {spk_id: memory.known_speakers[spk_id] for spk_id in names}

    speakers = dict.fromkeys(_effective_speaker(seg) for seg in t.segments)
    result = {}
    for spk_id in speakers:
        # Unassigned segments may mix several voices — nothing to compare.
        if not spk_id or spk_id == UNASSIGNED or memory.get_name(spk_id) is not None:
            continue
        rows = storage.speaker_segments(spk_id, transcript_id)
        voice = voice_centroid([row["embedding"] for row in rows if row["embedding"] is not None])
        sample = pick_voice_sample(rows, voice, os.path.isfile)
        result[spk_id] = UnknownSpeakerCandidates(
            candidates=[SpeakerCandidate(**c) for c in rank_candidates(voice, profiles, names)] if voice is not None else [],
            clip=VoiceClip(start=sample["start"], end=sample["end"], text=sample["text"]) if sample else None,
        )
    return result


@router.patch("/{transcript_id}", status_code=204)
def update_transcript(
    transcript_id: int,
    body: TranscriptUpdateRequest,
    storage: TranscriptStorageService = Depends(get_storage_service),
):
    """Edit transcript metadata (title). Speakers and segments are untouched."""
    if not storage.update_title(transcript_id, body.title):
        raise HTTPException(status_code=404, detail="Transcript not found")


@router.post("/{transcript_id}/opened", status_code=204)
def mark_transcript_opened(
    transcript_id: int,
    storage: TranscriptStorageService = Depends(get_storage_service),
):
    """The user opened the transcript. Only this flag changes; GET /transcripts/{id}
    leaves it alone, so repeated loads do not set it."""
    if not storage.mark_opened(transcript_id):
        raise HTTPException(status_code=404, detail="Transcript not found")


@router.delete("/{transcript_id}/opened", status_code=204)
def mark_transcript_unopened(
    transcript_id: int,
    storage: TranscriptStorageService = Depends(get_storage_service),
):
    """The user marked the transcript unread: it is listed as not opened until
    POST /transcripts/{id}/opened. Only this flag changes."""
    if not storage.mark_unopened(transcript_id):
        raise HTTPException(status_code=404, detail="Transcript not found")


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
    _delete_owned_recording(t.audio_path, storage)


@router.post(
    "/{transcript_id}/speaker-assignments", response_model=SpeakerAssignmentResponse,
    responses={400: {"model": RefusalResponse}, 409: {"model": RefusalResponse}},
)
def assign_speaker(
    transcript_id: int,
    body: SpeakerAssignmentRequest,
    storage: TranscriptStorageService = Depends(get_storage_service),
    memory: SpeakerMemoryService = Depends(get_memory_service),
):
    """Give the listed segments one speaker, all or none. Nothing is created
    until the request is known to be good."""
    if (body.speaker_id is None) == (body.speaker_name is None):
        raise HTTPException(status_code=400, detail="Provide exactly one of speaker_id or speaker_name")
    _check_new_speaker_color(body.color_index, body.speaker_name is not None)
    if body.speaker_handle is not None and body.speaker_name is None:
        raise HTTPException(status_code=400, detail="speaker_handle is only allowed when creating a speaker by name")
    try:
        t = storage.load(transcript_id, with_embeddings=False)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")
    by_start = {seg.start: seg for seg in t.segments}
    if any(start not in by_start for start in body.segment_starts):
        raise HTTPException(status_code=404, detail="Segment not found")
    if body.speaker_id is not None:
        _check_known_speaker(memory, body.speaker_id)
        to_spk_id = body.speaker_id
    else:
        to_spk_id = _create_speaker(memory, body.speaker_name, body.color_index, body.speaker_handle)
    segments = [by_start[start] for start in body.segment_starts]
    storage.set_segments_speaker(transcript_id, [(seg.start, seg.end) for seg in segments], to_spk_id)
    commit_svc = CommitService(memory, storage)
    commit_svc.commit_speaker(to_spk_id)
    for from_spk_id in {_effective_speaker(seg) for seg in segments} - {to_spk_id}:
        commit_svc.recompute_or_remove(from_spk_id)
    return SpeakerAssignmentResponse(speaker_id=to_spk_id)


@router.post("/{transcript_id}/speaker-assignments/undo", status_code=204)
def undo_speaker_assignment(
    transcript_id: int,
    body: SpeakerAssignmentUndoRequest,
    storage: TranscriptStorageService = Depends(get_storage_service),
    memory: SpeakerMemoryService = Depends(get_memory_service),
):
    """A segment deleted since the assignment has nothing to go back to and is skipped."""
    if body.speaker_id != UNASSIGNED:
        _check_uuid(body.speaker_id, "speaker_id")
    if body.created_speaker_id is not None:
        _check_uuid(body.created_speaker_id, "created_speaker_id")
    try:
        t = storage.load(transcript_id, with_embeddings=False)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transcript not found")
    starts = set(body.segment_starts)
    segments = [seg for seg in t.segments if seg.start in starts]
    CommitService(memory, storage).undo_assignment(
        transcript_id,
        [(seg.start, seg.end) for seg in segments],
        body.speaker_id,
        {_effective_speaker(seg) for seg in segments},
        body.created_speaker_id,
    )


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
