import type { components } from './schema.gen'

type Schemas = components['schemas']

export type Segment = Schemas['SegmentResponse']
export type Transcript = Schemas['TranscriptResponse']
export type TranscriptListItem = Schemas['TranscriptListItem']
export type Speaker = Schemas['SpeakerResponse']
export type SpeakerSample = Schemas['SpeakerSampleResponse']
export type SpeakerUpdate = Schemas['SpeakerUpdateRequest']
// A recording a speaker talks in, with whether its audio file is still there.
export type SpeakerTranscript = Schemas['SpeakerTranscriptItem']
// How many segments, in how many recordings, a deleted speaker left Unassigned.
export type SpeakerDeleteSummary = Schemas['SpeakerDeleteResponse']
// What a refusal of the queue's job routes is about; the message is for the user.
export type RefusalCode = Schemas['RefusalResponse']['code']
export type QueueJob = Schemas['QueueJob']
export type QueueSnapshot = Schemas['QueueSnapshot']
// Only the fields given change. A null language is one detected from the audio.
export type QueueJobUpdate = Schemas['JobUpdateRequest']
export type QueueStartMode = Schemas['QueueSettingsRequest']['start_mode']
export type GpuStatus = Schemas['GpuStatus']
export type DataResetSummary = Schemas['DataResetResponse']
// A system audio source the backend can capture, by the name of its output device.
export type AudioSource = Schemas['AudioSource']
export type JobDoneEvent = Schemas['JobDoneEvent']
export type JobFailedEvent = Schemas['JobFailedEvent']
export type HeartbeatEvent = Schemas['HeartbeatEvent']
// A row of GET /models. Alignment models carry only their id and whether they are there.
export type ModelInfo = Schemas['TranscriptionModelInfo'] | Schemas['AlignmentModelInfo']

// What WS /ws/queue sends. Heartbeats only keep the connection alive, so
// subscribers get the rest.
export type QueueEvent = QueueUpdate | HeartbeatEvent
export type QueueUpdate = QueueSnapshot | JobDoneEvent | JobFailedEvent

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
