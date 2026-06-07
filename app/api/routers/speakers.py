from fastapi import APIRouter, Depends, HTTPException

from app.services.speaker_memory_service import SpeakerMemoryService
from app.api.dependencies import get_memory_service
from app.api.schemas import SpeakerResponse, RenameRequest

router = APIRouter(prefix="/speakers", tags=["speakers"])


@router.get("", response_model=list[SpeakerResponse])
def list_speakers(memory: SpeakerMemoryService = Depends(get_memory_service)):
    return [
        SpeakerResponse(id=spk_id, name=name, color_index=memory.get_color_index(spk_id) or 0)
        for spk_id in memory.known_speakers
        if (name := memory.get_name(spk_id)) is not None
    ]


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
