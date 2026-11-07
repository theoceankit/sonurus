import type {
  DataResetSummary, GpuStatus, ModelInfo, QueueJob, QueueJobUpdate, QueueSnapshot, QueueStartMode, QueueUpdate, Speaker, SpeakerCandidates, SpeakerSample, SpeakerUpdate, Transcript, TranscriptListItem,
} from './types'
import type { GpuDownloadEvent, GpuRestartAnswer } from './gpu-events'
import type { ModelDownloadEvent } from './model-download-events'

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

// A file for the transcription queue. A null model or language is the backend's own:
// its default model, and the language detected from the audio. No title is the file name.
export type NewQueueJob = { audioPath: string; whisperModel: string | null; language: string | null; title?: string | null }

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
  // Every model of the catalog with whether it is downloaded.
  listModels(): Promise<ModelInfo[]>
  // Starts downloading a model, or joins its download already running, and answers the
  // job. The token is for gated models on HuggingFace.
  startModelDownload(modelId: string, hfToken: string | null): Promise<string>
  cancelModelDownload(modelId: string, jobId: string): Promise<void>
  // Refused with a 409 while the running transcription needs the model.
  deleteModel(modelId: string): Promise<void>
  // The progress of a download until it ends. Returns what stops listening.
  watchModelDownload(jobId: string, listener: (event: ModelDownloadEvent) => void): () => void
  // GPU acceleration of the packaged app: what is there, the one CUDA download, its
  // removal, and whether the backend may restart now to apply either.
  getGpuStatus(): Promise<GpuStatus>
  // Refused with a 409 while the GPU does not qualify or a download runs.
  startGpuDownload(): Promise<string>
  cancelGpuDownload(jobId: string): Promise<void>
  watchGpuDownload(jobId: string, listener: (event: GpuDownloadEvent) => void): () => void
  removeGpuPack(): Promise<void>
  // A 409 when there is nothing to apply.
  requestGpuRestart(): Promise<GpuRestartAnswer>
  // Deletes every transcript, speaker and recording made in the app. Refused with a
  // 409 while a transcription or a recording runs.
  resetData(): Promise<DataResetSummary>
  getQueue(): Promise<QueueSnapshot>
  // Start and pause answer the queue after the change. A pause stops the running job at
  // once; it waits again at its place.
  startQueue(): Promise<QueueSnapshot>
  pauseQueue(): Promise<QueueSnapshot>
  // Every job of the queue exactly once, in the new order; anything else is a 400.
  reorderQueue(jobIds: readonly string[]): Promise<QueueSnapshot>
  // Takes the job and its copy of the audio away; a running job is stopped first. 404
  // when there is no such job.
  deleteQueueJob(jobId: string): Promise<void>
  // The backend copies the file and answers the waiting job, or 400 when a model the
  // job needs is not installed or the file cannot be read.
  addQueueJob(job: NewQueueJob): Promise<QueueJob>
  // Title, model or language of a job that is not running. Refused with a 400 when the
  // model or the alignment model of the language is not installed, 409 while it runs.
  updateQueueJob(jobId: string, update: QueueJobUpdate): Promise<QueueJob>
  // A failed job waits again, at the end of the queue. Refused with a 400 when a model it
  // needs is still not installed, 409 when the job has not failed.
  retryQueueJob(jobId: string): Promise<QueueJob>
  // Whether new jobs start on their own or wait for Start; the backend keeps it.
  setQueueStartMode(startMode: QueueStartMode): Promise<QueueSnapshot>
  // The listener first gets the current snapshot. onConnection is told when the
  // connection is lost and when it is back. Returns the unsubscribe.
  subscribeQueueEvents(listener: (event: QueueUpdate) => void, onConnection?: (connected: boolean) => void): () => void
}
