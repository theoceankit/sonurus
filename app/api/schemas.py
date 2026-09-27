from pydantic import BaseModel, Field, field_validator


class SegmentResponse(BaseModel):
    start: float
    end: float
    text: str
    speaker_raw: str
    speaker_resolved: str | None
    speaker_final: str | None
    unassigned: bool = False


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
    """A speaker in the Speakers section. name is None for unnamed speakers."""
    id: str
    name: str | None
    color_index: int
    segments: int = 0
    transcripts: int = 0
    duration_sec: float = 0.0
    last_seen: str = ""


class SpeakerUpdateRequest(BaseModel):
    """At least one of name / color_index."""
    name: str | None = Field(default=None, min_length=1, max_length=128)
    color_index: int | None = None

    @field_validator('name', mode='before')
    @classmethod
    def strip_name(cls, v):
        return v.strip() if isinstance(v, str) else v


class SpeakerDeleteResponse(BaseModel):
    segments: int
    transcripts: int


class SpeakerTranscriptItem(BaseModel):
    id: int
    title: str
    created_at: str
    segments: int
    duration_sec: float


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
    """Exactly one of: an existing speaker_id, or speaker_name to create a new speaker."""
    speaker_id: str | None = None
    speaker_name: str | None = Field(default=None, min_length=1, max_length=128)

    @field_validator('speaker_name', mode='before')
    @classmethod
    def strip_name(cls, v):
        return v.strip() if isinstance(v, str) else v


class SegmentTextRequest(BaseModel):
    text: str


class DownloadRequest(BaseModel):
    hf_token: str | None = None


class ReassignRequest(BaseModel):
    from_speaker_id: str
    to_speaker_id: str | None = None
    to_speaker_name: str | None = None


class DataResetResponse(BaseModel):
    transcripts: int
    speakers: int
    files: int
