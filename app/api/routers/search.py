"""Search of recordings by transcript, title and note (SearchService)."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.dependencies import get_memory_service, get_storage_service
from app.api.schemas import SearchResponse
from app.services.search_query import SearchQueryError
from app.services.search_service import RecordingNotFound, SearchRefused, SearchService
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService

router = APIRouter(prefix="/search", tags=["search"])


def get_search_service(
    storage: TranscriptStorageService = Depends(get_storage_service),
    memory: SpeakerMemoryService = Depends(get_memory_service),
) -> SearchService:
    return SearchService(storage, memory)


@router.get("", response_model=SearchResponse, responses={400: {"description": "A query or filter that cannot run"},
                                                          404: {"description": "No such recording"}})
def search(
    q: Annotated[str, Query(description="Words, AND / OR / NOT in capitals, (groups), \"phrases\"")],
    speaker: Annotated[str | None, Query(description="Handle of a named speaker, with or without @")] = None,
    date_from: Annotated[str | None, Query(alias="from", description="YYYY-MM-DD, local, inclusive")] = None,
    date_to: Annotated[str | None, Query(alias="to", description="YYYY-MM-DD, local, inclusive")] = None,
    recording_id: Annotated[int | None, Query(description="Only this recording; offset then pages its hits")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    hits_per_recording: Annotated[int, Query(ge=1, le=50)] = 3,
    service: SearchService = Depends(get_search_service),
):
    try:
        return service.search(q, speaker=speaker, date_from=date_from, date_to=date_to,
                              recording_id=recording_id, limit=limit, offset=offset,
                              hits_per_recording=hits_per_recording)
    except (SearchQueryError, SearchRefused) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RecordingNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
