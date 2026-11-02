import type {
  QueueSnapshot, QueueUpdate, Speaker, SpeakerCandidates, SpeakerSample, SpeakerUpdate, Transcript, TranscriptListItem,
} from './types'

// status 0: the request never got an answer.
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// An existing speaker, or a new one by name.
export type SpeakerTarget = { id: string } | { name: string; colorIndex?: number }

// One segment, or every segment of a speaker in the transcript.
export type SpeakerAssignment = { transcriptId: number; target: SpeakerTarget }
  & ({ segmentStart: number } | { fromSpeakerId: string })

// Everything a screen knows about the backend. Screens get it through
// useApi(), so they work the same on fixtures and on the real thing.
export interface ApiClient {
  // Today for the screens: the list's sections on fixtures must stay as on the boards.
  now(): Date
  listTranscripts(): Promise<TranscriptListItem[]>
  getTranscript(transcriptId: number): Promise<Transcript>
  // What an audio element plays for this recording, null when there is nothing to play.
  getAudioUrl(transcript: Transcript): string | null
  updateTranscriptTitle(transcriptId: number, title: string): Promise<void>
  deleteTranscript(transcriptId: number): Promise<void>
  updateSegmentText(transcriptId: number, segmentStart: number, text: string): Promise<void>
  deleteSegment(transcriptId: number, segmentStart: number): Promise<void>
  assignSpeaker(assignment: SpeakerAssignment): Promise<void>
  getSpeakerCandidates(transcriptId: number): Promise<SpeakerCandidates>
  listSpeakers(): Promise<Speaker[]>
  updateSpeaker(speakerId: string, update: SpeakerUpdate): Promise<Speaker>
  getSpeakerSample(speakerId: string, transcriptId?: number): Promise<SpeakerSample>
  getQueue(): Promise<QueueSnapshot>
  // The listener first gets the current snapshot. Returns the unsubscribe.
  subscribeQueueEvents(listener: (event: QueueUpdate) => void): () => void
}
