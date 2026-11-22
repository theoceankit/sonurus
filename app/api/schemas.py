import json

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ResponseModel(BaseModel):
    """A field with a default is still always in the response, so the schema
    the UI's types come from lists it as required."""
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
    # False until the user opens the transcript: the UI marks it as new.
    opened: bool
    # The recording has a note; the delete dialog says it goes too.
    has_note: bool
    speakers: list[str]
    section: str
    duration: str


class TranscriptResponse(ResponseModel):
    id: int
    audio_path: str
    language: str
    status: str
    title: str | None = None
    # False: transcribed without looking for speakers.
    diarized: bool
    segments: list[SegmentResponse]


# What a note may weigh as JSON: far more than a meeting's minutes ever need.
NOTE_MAX_BYTES = 1_000_000


class NoteResponse(ResponseModel):
    # The editor's document (Tiptap JSON), or null when the recording has no note.
    content: dict | None
    updated_at: str | None


class NoteRequest(BaseModel):
    content: dict

    @field_validator('content')
    @classmethod
    def check_document(cls, v):
        if v.get('type') != 'doc':
            raise ValueError('content must be an editor document of type "doc"')
        if len(json.dumps(v, ensure_ascii=False).encode('utf-8')) > NOTE_MAX_BYTES:
            raise ValueError(f'the note is over {NOTE_MAX_BYTES} bytes')
        return v


class TranscriptUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)

    @field_validator('title', mode='before')
    @classmethod
    def strip_title(cls, v):
        return v.strip() if isinstance(v, str) else v


class SpeakerResponse(ResponseModel):
    """A speaker in the Speakers section. name is None for unnamed speakers, and
    so is handle: only a named speaker has one. handle_manual: set by hand, so it
    stays when the name changes. photo: the file name of the speaker's photo
    (GET /speakers/{id}/photo), new with every upload; only a named speaker has one."""
    id: str
    name: str | None
    handle: str | None = None
    handle_manual: bool = False
    color_index: int
    photo: str | None = None
    segments: int = 0
    transcripts: int = 0
    duration_sec: float = 0.0
    last_seen: str = ""


class SpeakerUpdateRequest(BaseModel):
    """At least one of name / color_index / handle. handle: one set by hand (a
    leading @ and the case do not matter), or "" for the one made from the name."""
    name: str | None = Field(default=None, min_length=1, max_length=128)
    color_index: int | None = None
    handle: str | None = Field(default=None, max_length=64)

    @field_validator('name', mode='before')
    @classmethod
    def strip_name(cls, v):
        return v.strip() if isinstance(v, str) else v


class SpeakerCreateRequest(BaseModel):
    """A speaker made by name, before any recording has them. handle: one set by
    hand (a leading @ and the case do not matter); left out or "", the one made
    from the name. color_index: the palette colour, else the least used one."""
    name: str = Field(min_length=1, max_length=128)
    handle: str | None = Field(default=None, max_length=64)
    color_index: int | None = None

    @field_validator('name', mode='before')
    @classmethod
    def strip_name(cls, v):
        return v.strip() if isinstance(v, str) else v


class SpeakerDeleteResponse(BaseModel):
    segments: int
    transcripts: int


class SpeakerMergeRequest(BaseModel):
    """POST /speakers/{id}/merge: the speaker who stays."""
    into_id: str


class SpeakerMergeResponse(BaseModel):
    """The speaker who stays, as they are after the merge, and how many segments
    in how many transcripts moved to them."""
    speaker: SpeakerResponse
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
    # Whether the recording's audio file is still on disk, so a sample can play.
    has_audio: bool


class SpeakerCandidate(ResponseModel):
    """A known speaker that a voice may be. score is cosine similarity, not below
    0. Only the first candidate can be suggested."""
    speaker_id: str
    name: str
    score: float
    suggested: bool


class VoiceClip(ResponseModel):
    """A segment of the transcript's own audio to hear an unknown voice."""
    start: float
    end: float
    text: str


class WaveformResponse(ResponseModel):
    """GET /transcripts/{id}/waveform: one height per bar, from 0 (silence) to 1
    (the loud part of the recording)."""
    levels: list[float]


class UnknownSpeakerCandidates(ResponseModel):
    """GET /transcripts/{id}/speaker-candidates, per speaker without a name and
    per possible match: a speaker recognized with a low similarity, to confirm,
    who comes first among the candidates. clip is null when the audio file is gone."""
    candidates: list[SpeakerCandidate]
    clip: VoiceClip | None
    possible_match: bool


RefusalCode = Literal[
    "whisper_model_missing", "diarization_model_missing", "alignment_model_missing",
    "audio_not_found", "audio_not_readable", "audio_copy_failed", "job_running",
    "handle_invalid", "handle_taken", "handle_needs_name", "photo_needs_name", "merge_into_self",
    "transcript_not_diarized",
]

HandleFormat = Literal["first.last", "f.last", "first.l"]


class HandleFormatBody(BaseModel):
    """How a handle is made from a name: ivan.petrov, i.petrov or ivan.p."""
    format: HandleFormat


class HandleSuggestionResponse(BaseModel):
    handle: str


class RefusalResponse(BaseModel):
    """A refusal of the queue's job routes (400, and 409 for a job that started)
    and of a speaker's handle (400, and 409 for a taken one): a message for the
    user and what it is about."""
    detail: str
    code: RefusalCode


class TranscribeRequest(BaseModel):
    """POST /queue/jobs. language null or "auto" = auto-detect; no title =
    the file name without its extension. diarize false = no speakers, and
    neither the diarization model nor a token is needed."""
    audio_path: str
    whisper_model: str | None = None
    language: str | None = None
    title: str | None = None
    diarize: bool = True


class QueueJob(BaseModel):
    id: str
    audio_path: str
    title: str
    whisper_model: str
    language: str | None
    diarize: bool
    status: Literal["waiting", "running", "failed"]
    error: str | None
    error_code: str | None
    error_language: str | None
    created_at: str


class LiveRecording(BaseModel):
    """The live recording in the queue snapshot. started_at: when its first
    track started, Unix time in seconds (null while starting)."""
    phase: Literal["starting", "live", "stopping"]
    title: str
    started_at: float | None
    sources: list[Literal["mic", "system"]]


class QueueSnapshot(ResponseModel):
    type: Literal["snapshot"] = "snapshot"
    paused: bool
    paused_by_recording: bool
    recording: LiveRecording | None
    start_mode: Literal["auto", "manual"]
    running_job_id: str | None
    step: str | None
    jobs: list[QueueJob]


class JobDoneEvent(BaseModel):
    """WS /ws/queue. TranscriptionQueue sends these events as plain dicts;
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


class RecordingFailedEvent(BaseModel):
    """The recording stopped but could not be saved or queued."""
    type: Literal["recording_failed"]
    title: str
    error: str


class RecordingSourceLostEvent(BaseModel):
    """A track ended by itself (a device unplugged): the recording was
    stopped, saved and queued."""
    type: Literal["recording_source_lost"]
    source: Literal["mic", "system"]
    title: str


class RecordingSystemSilentEvent(BaseModel):
    """The recording was saved and queued, but its system audio held zeros
    only. On macOS that is also what a refused System Audio Recording
    permission gives: a hint where to allow it, not an error."""
    type: Literal["recording_system_silent"]
    title: str


class MicAppActiveEvent(BaseModel):
    """Another app has held a microphone for a while and no recording runs:
    a call may have started. Once per hold; app_id is stable across holds,
    name is null where the system does not say which app it is."""
    type: Literal["mic_app_active"]
    app_id: str
    name: str | None


class CallEndedEvent(BaseModel):
    """The live recording may have outlived its call: every other app let go
    of the microphone (mic_released), or no track had sound for a while
    (silence). The recording goes on."""
    type: Literal["call_ended"]
    reason: Literal["mic_released", "silence"]


class MicWatchResponse(BaseModel):
    """GET /audio/mic-watch: whether this system tells when another app holds
    a microphone, and whether it says which app."""
    available: bool
    names: bool


class HeartbeatEvent(BaseModel):
    type: Literal["heartbeat"]


class JobUpdateRequest(BaseModel):
    """PATCH /queue/jobs/{id}: only the fields sent are changed; language
    null or "auto" = auto-detect."""
    title: str | None = Field(default=None, min_length=1, max_length=200)
    whisper_model: str | None = Field(default=None, min_length=1)
    language: str | None = None
    diarize: bool | None = None

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


class SpeakerAssignmentRequest(BaseModel):
    """The segments that change, all together, by their start, and exactly one of:
    an existing speaker_id, or speaker_name to create a new speaker. color_index
    sets the new speaker's palette color and speaker_handle its handle instead of
    the one made from the name (both only with speaker_name)."""
    speaker_id: str | None = None
    speaker_name: str | None = Field(default=None, min_length=1, max_length=128)
    color_index: int | None = None
    speaker_handle: str | None = Field(default=None, max_length=64)

    @field_validator('speaker_name', mode='before')
    @classmethod
    def strip_name(cls, v):
        return v.strip() if isinstance(v, str) else v

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
    """GET /models: the alignment model of a language; the UI names the language."""
    id: str
    installed: bool
    size: str
    kind: Literal["alignment"]


ModelInfo = Annotated[TranscriptionModelInfo | AlignmentModelInfo, Field(discriminator="kind")]


class ModelsFolder(BaseModel):
    """GET /models/folder: where this backend keeps every downloaded model."""
    path: str
    exists: bool


class DownloadRequest(BaseModel):
    hf_token: str | None = None


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
