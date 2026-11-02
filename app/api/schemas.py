from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ResponseModel(BaseModel):
    """A field with a default is still always in the response, so the schema
    the new UI's types come from lists it as required."""
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class SegmentResponse(ResponseModel):
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


class TranscriptResponse(ResponseModel):
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


class SpeakerResponse(ResponseModel):
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


class SpeakerSuggestion(BaseModel):
    """GET /transcripts/{id}/speaker-suggestions: the known speaker closest to
    an unrecognized one."""
    speaker_id: str
    name: str
    score: float


class SpeakerCandidate(ResponseModel):
    """A known speaker that an unknown voice may be. score is cosine similarity,
    not below 0. Only the first candidate can be suggested."""
    speaker_id: str
    name: str
    score: float
    suggested: bool


class VoiceClip(ResponseModel):
    """A segment of the transcript's own audio to hear an unknown voice."""
    start: float
    end: float
    text: str


class UnknownSpeakerCandidates(ResponseModel):
    """GET /transcripts/{id}/speaker-candidates, per speaker without a name. clip
    is null when the audio file is gone."""
    candidates: list[SpeakerCandidate]
    clip: VoiceClip | None


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


class QueueSnapshot(ResponseModel):
    type: Literal["snapshot"] = "snapshot"
    paused: bool
    paused_by_recording: bool
    recording: bool
    start_mode: Literal["auto", "manual"]
    running_job_id: str | None
    step: str | None
    jobs: list[QueueJob]


class JobDoneEvent(BaseModel):
    """WS /ws/queue. TranscriptionQueue sends these three as plain dicts;
    tests hold them to these models."""
    type: Literal["job_done"]
    job_id: str
    title: str
    transcript_id: int


class JobFailedEvent(BaseModel):
    type: Literal["job_failed"]
    job_id: str
    title: str
    error: str
    error_code: str | None
    error_language: str | None


class HeartbeatEvent(BaseModel):
    type: Literal["heartbeat"]


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


class SpeakerAssignmentRequest(SegmentSpeakerRequest):
    """The segments that change, all together, by their start."""
    segment_starts: list[float] = Field(min_length=1)


class SpeakerAssignmentResponse(ResponseModel):
    speaker_id: str


class SpeakerAssignmentUndoRequest(BaseModel):
    """speaker_id is who the segments had: a voice removed by the assignment is not
    in memory any more, or UNASSIGNED. created_speaker_id is the speaker the
    assignment made, if it did."""
    segment_starts: list[float] = Field(min_length=1)
    speaker_id: str
    created_speaker_id: str | None = None


class SegmentTextRequest(BaseModel):
    text: str


class TranscriptionModelInfo(BaseModel):
    """GET /models: a Whisper or diarization model of the catalog."""
    id: str
    installed: bool
    name: str
    size: str
    speed: str
    acc: str
    recommended: bool
    kind: Literal["whisper", "diarization"]


class AlignmentModelInfo(BaseModel):
    id: str
    installed: bool
    kind: Literal["alignment"]


ModelInfo = Annotated[TranscriptionModelInfo | AlignmentModelInfo, Field(discriminator="kind")]


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


class GpuDevice(BaseModel):
    name: str
    driver: str
    compute_capability: str


class GpuStatus(BaseModel):
    blocked_reason: Literal[
        "unsupported_platform", "not_packaged", "no_nvidia", "driver_too_old", "gpu_too_old",
    ] | None
    gpu: GpuDevice | None
    min_driver: str | None
    min_compute_capability: str | None
    state: Literal["not_installed", "downloading", "pending_restart", "active", "error", "stale"]
    pending: Literal["install", "remove"] | None
    error: str | None
    download_size: int | None
    device: str
    torch: str | None
