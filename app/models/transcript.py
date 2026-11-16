from dataclasses import dataclass, field
from typing import List
from app.models.segment import Segment


@dataclass
class Transcript:
    segments: List[Segment] = field(default_factory=list)

    audio_path: str = ""
    language: str = ""

    status: str = "draft"

    title: str | None = None

    # {speaker id: cosine similarity} of the speakers recognized from memory
    match_scores: dict[str, float] = field(default_factory=dict)

    # set by TranscriptStorageService.save()
    db_id: int | None = None