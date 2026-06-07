from pydantic import BaseModel, Field, field_validator


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
    title: str | None = None
    segments: list[SegmentResponse]


class SpeakerResponse(BaseModel):
    id: str
    name: str
    color_index: int


class JobStarted(BaseModel):
    job_id: str


class TranscribeRequest(BaseModel):
    audio_path: str
    whisper_model: str | None = None
    language: str | None = None
    title: str | None = None


class RenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)

    @field_validator('name', mode='before')
    @classmethod
    def strip_name(cls, v: str) -> str:
        return v.strip() if isinstance(v, str) else v


class SegmentSpeakerRequest(BaseModel):
    speaker_id: str


class SegmentTextRequest(BaseModel):
    text: str


class DownloadRequest(BaseModel):
    hf_token: str | None = None


class ReassignRequest(BaseModel):
    from_speaker_id: str
    to_speaker_id: str | None = None
    to_speaker_name: str | None = None
