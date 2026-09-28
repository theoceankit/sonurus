from typing import Literal

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


class TranscriptUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)

    @field_validator('title', mode='before')
    @classmethod
    def strip_title(cls, v):
        return v.strip() if isinstance(v, str) else v


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


class SpeakerSampleResponse(BaseModel):
    transcript_id: int
    audio_path: str
    start: float
    end: float
    text: str


class SpeakerTranscriptItem(BaseModel):
    id: int
    title: str
    created_at: str
    segments: int
    duration_sec: float


class TranscribeRequest(BaseModel):
    """POST /queue/jobs. language null or "auto" = auto-detect; no title =
    the file name without its extension."""
    audio_path: str
    whisper_model: str | None = None
    language: str | None = None
    title: str | None = None


class QueueJob(BaseModel):
    id: str
    audio_path: str
    title: str
    whisper_model: str
    language: str | None
    status: Literal["waiting", "running", "failed"]
    error: str | None
    error_code: str | None
    error_language: str | None
    created_at: str


class QueueSnapshot(BaseModel):
    type: Literal["snapshot"] = "snapshot"
    paused: bool
    paused_by_recording: bool
    recording: bool
    start_mode: Literal["auto", "manual"]
    running_job_id: str | None
    step: str | None
    jobs: list[QueueJob]


class JobUpdateRequest(BaseModel):
    """PATCH /queue/jobs/{id}: only the fields sent are changed; language
    null or "auto" = auto-detect."""
    title: str | None = Field(default=None, min_length=1, max_length=200)
    whisper_model: str | None = Field(default=None, min_length=1)
    language: str | None = None

    @field_validator('title', mode='before')
    @classmethod
    def strip_title(cls, v):
        return v.strip() if isinstance(v, str) else v


class QueueOrderRequest(BaseModel):
    job_ids: list[str]


class QueueSettingsRequest(BaseModel):
    start_mode: Literal["auto", "manual"]


class JobDeleted(BaseModel):
    deleted: bool


class RenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)

    @field_validator('name', mode='before')
    @classmethod
    def strip_name(cls, v: str) -> str:
        return v.strip() if isinstance(v, str) else v


class SegmentSpeakerRequest(BaseModel):
    """Exactly one of: an existing speaker_id, or speaker_name to create a new speaker.
    color_index sets the new speaker's palette color (only with speaker_name)."""
    speaker_id: str | None = None
    speaker_name: str | None = Field(default=None, min_length=1, max_length=128)
    color_index: int | None = None

    @field_validator('speaker_name', mode='before')
    @classmethod
    def strip_name(cls, v):
        return v.strip() if isinstance(v, str) else v


class SegmentTextRequest(BaseModel):
    text: str


class DownloadRequest(BaseModel):
    hf_token: str | None = None


class ReassignRequest(BaseModel):
    """color_index sets the new speaker's palette color (only with to_speaker_name)."""
    from_speaker_id: str
    to_speaker_id: str | None = None
    to_speaker_name: str | None = None
    color_index: int | None = None


class DataResetResponse(BaseModel):
    transcripts: int
    speakers: int
    files: int
