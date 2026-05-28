from pydantic import BaseModel


class SegmentResponse(BaseModel):
    start: float
    end: float
    text: str
    speaker_raw: str
    speaker_resolved: str | None
    speaker_final: str | None


class TranscriptListItem(BaseModel):
    id: int
    title: str
    created_at: str
    status: str
    speakers: list[str]
    section: str
    duration: str


class TranscriptResponse(BaseModel):
    id: int
    audio_path: str
    language: str
    status: str
    segments: list[SegmentResponse]


class SpeakerResponse(BaseModel):
    id: str
    name: str


class JobStarted(BaseModel):
    job_id: str


class TranscribeRequest(BaseModel):
    audio_path: str
    whisper_model: str | None = None
    language: str | None = None
    title: str | None = None


class RenameRequest(BaseModel):
    name: str


class SegmentSpeakerRequest(BaseModel):
    speaker_id: str


class SegmentTextRequest(BaseModel):
    text: str


class ReassignRequest(BaseModel):
    from_speaker_id: str
    to_speaker_id: str | None = None
    to_speaker_name: str | None = None
