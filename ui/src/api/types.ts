import type { components } from './schema.gen'

type Schemas = components['schemas']

export type Segment = Schemas['SegmentResponse']
export type Transcript = Schemas['TranscriptResponse']
export type TranscriptListItem = Schemas['TranscriptListItem']
// photo_url: what an img shows as the speaker's photo, added by the client from
// photo; null without one.
export type Speaker = Schemas['SpeakerResponse'] & { photo_url?: string | null }
export type SpeakerSample = Schemas['SpeakerSampleResponse']
export type SpeakerUpdate = Schemas['SpeakerUpdateRequest']
export type SpeakerCreate = Schemas['SpeakerCreateRequest']
// How a handle is made from a name: ivan.petrov, i.petrov or ivan.p.
export type HandleFormat = Schemas['HandleFormatBody']['format']
export const DEFAULT_HANDLE_FORMAT: HandleFormat = 'first.last'
// A recording a speaker talks in, with whether its audio file is still there.
export type SpeakerTranscript = Schemas['SpeakerTranscriptItem']
// How many segments, in how many recordings, a deleted speaker left Unassigned.
export type SpeakerDeleteSummary = Schemas['SpeakerDeleteResponse']
export type SpeakerMergeSummary = Omit<Schemas['SpeakerMergeResponse'], 'speaker'> & { speaker: Speaker }
// What a refusal of the queue's job routes is about; the message is for the user.
export type RefusalCode = Schemas['RefusalResponse']['code']
export type QueueJob = Schemas['QueueJob']
export type QueueSnapshot = Schemas['QueueSnapshot']
// Only the fields given change. A null language is one detected from the audio.
export type QueueJobUpdate = Schemas['JobUpdateRequest']
export type QueueStartMode = Schemas['QueueSettingsRequest']['start_mode']
export type GpuStatus = Schemas['GpuStatus']
export type DataResetSummary = Schemas['DataResetResponse']
// A system audio source the backend can capture, by the name of its output device, or
// a microphone by its own name.
export type AudioSource = Schemas['AudioSource']
// The live recording in the queue snapshot; started_at is Unix time in seconds.
export type LiveRecording = Schemas['LiveRecording']
// What a recording takes and what it is queued with when it stops. A null device or
// source is the default one.
export type RecordingStart = Schemas['RecordingStartRequest']
export type RecordingFailedEvent = Schemas['RecordingFailedEvent']
export type RecordingSourceLostEvent = Schemas['RecordingSourceLostEvent']
export type JobDoneEvent = Schemas['JobDoneEvent']
export type JobFailedEvent = Schemas['JobFailedEvent']
export type HeartbeatEvent = Schemas['HeartbeatEvent']
// A row of GET /models. Alignment models carry only their id and whether they are there.
export type ModelInfo = Schemas['TranscriptionModelInfo'] | Schemas['AlignmentModelInfo']
export type ModelsFolder = Schemas['ModelsFolder']

// What WS /ws/queue sends. Heartbeats only keep the connection alive, so
// subscribers get the rest.
export type QueueEvent = QueueUpdate | HeartbeatEvent
export type QueueUpdate = QueueSnapshot | JobDoneEvent | JobFailedEvent | RecordingFailedEvent | RecordingSourceLostEvent

// A known speaker that an unrecognized one may be. score is cosine similarity,
// suggested marks the first candidate when it is close enough.
export type SpeakerCandidate = Schemas['SpeakerCandidate']

// By unrecognized speaker id: the closest candidates first and a clip of the voice.
export type SpeakerCandidates = Record<string, Schemas['UnknownSpeakerCandidates']>

export const UNASSIGNED = 'UNASSIGNED'

// The user's correction wins over automatic results.
export function effectiveSpeaker(segment: Segment): string {
  if (segment.unassigned) return UNASSIGNED
  return segment.speaker_final ?? segment.speaker_resolved ?? segment.speaker_raw
}

// The longest title the backend takes, for a recording (TranscriptUpdateRequest) and a
// queued job (JobUpdateRequest) alike.
export const TITLE_MAX_LENGTH = 200
