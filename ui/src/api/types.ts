import type { components } from './schema.gen'

type Schemas = components['schemas']

export type Segment = Schemas['SegmentResponse']
export type Transcript = Schemas['TranscriptResponse']
export type TranscriptListItem = Schemas['TranscriptListItem']
export type Speaker = Schemas['SpeakerResponse']
export type SpeakerSample = Schemas['SpeakerSampleResponse']
export type SpeakerUpdate = Schemas['SpeakerUpdateRequest']
export type QueueJob = Schemas['QueueJob']
export type QueueSnapshot = Schemas['QueueSnapshot']
export type JobDoneEvent = Schemas['JobDoneEvent']
export type JobFailedEvent = Schemas['JobFailedEvent']
export type HeartbeatEvent = Schemas['HeartbeatEvent']

// What WS /ws/queue sends. Heartbeats only keep the connection alive, so
// subscribers get the rest.
export type QueueEvent = QueueUpdate | HeartbeatEvent
export type QueueUpdate = QueueSnapshot | JobDoneEvent | JobFailedEvent

// A known speaker that an unrecognized one may be. score is cosine similarity.
export type SpeakerCandidate = Schemas['SpeakerSuggestion']

// By unrecognized speaker id, the closest candidate first.
export type SpeakerCandidates = Record<string, SpeakerCandidate[]>

export const UNASSIGNED = 'UNASSIGNED'

// The user's correction wins over automatic results.
export function effectiveSpeaker(segment: Segment): string {
  if (segment.unassigned) return UNASSIGNED
  return segment.speaker_final ?? segment.speaker_resolved ?? segment.speaker_raw
}
