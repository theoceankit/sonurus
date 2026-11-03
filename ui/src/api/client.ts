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

// The segments that get a speaker, all or none.
export type SpeakerAssignment = { transcriptId: number; segmentStarts: readonly number[]; target: SpeakerTarget }

// Puts segments back under the speaker they had before an assignment. A reassign
// the other way would also take the segments the new speaker had before it.
// createdSpeakerId: the assignment made this speaker, and with nothing left they go.
export type SpeakerUndo = { transcriptId: number; segmentStarts: readonly number[]; speakerId: string; createdSpeakerId?: string }

// Bars evenly over a stretch of a recording, in seconds.
export type WaveformStretch = { bars: number; start: number; end: number }

// Everything a screen knows about the backend. Screens get it through
// useApi(), so they work the same on fixtures and on the real thing.
export interface ApiClient {
  // Today for the screens: the list's sections on fixtures must stay as on the boards.
  now(): Date
  listTranscripts(): Promise<TranscriptListItem[]>
  getTranscript(transcriptId: number): Promise<Transcript>
  // What an audio element plays for this recording, null when there is nothing to play.
  getAudioUrl(transcript: Transcript): string | null
  // One height from 0 to 1 per bar, on the scale of the whole recording.
  getWaveform(transcriptId: number, stretch: WaveformStretch): Promise<number[]>
  updateTranscriptTitle(transcriptId: number, title: string): Promise<void>
  // The recording is no longer new. Loading it does not do this.
  markTranscriptOpened(transcriptId: number): Promise<void>
  deleteTranscript(transcriptId: number): Promise<void>
  updateSegmentText(transcriptId: number, segmentStart: number, text: string): Promise<void>
  deleteSegment(transcriptId: number, segmentStart: number): Promise<void>
  assignSpeaker(assignment: SpeakerAssignment): Promise<{ speakerId: string }>
  undoSpeakerAssignment(undo: SpeakerUndo): Promise<void>
  getSpeakerCandidates(transcriptId: number): Promise<SpeakerCandidates>
  listSpeakers(): Promise<Speaker[]>
  updateSpeaker(speakerId: string, update: SpeakerUpdate): Promise<Speaker>
  getSpeakerSample(speakerId: string, transcriptId?: number): Promise<SpeakerSample>
  getQueue(): Promise<QueueSnapshot>
  // The listener first gets the current snapshot. onConnection is told when the
  // connection is lost and when it is back. Returns the unsubscribe.
  subscribeQueueEvents(listener: (event: QueueUpdate) => void, onConnection?: (connected: boolean) => void): () => void
}
