import type { ApiClient } from '../api/client'
import { captureStartError } from './sources'

// One live recording, as the old UI makes it: the microphone is recorded in the window
// (WebM through MediaRecorder), system audio is captured by the backend on every OS,
// and the backend alone writes the files. While it runs the queue is paused.

export type RecordingRequest = {
  mic: boolean
  // Null is the default microphone.
  micDeviceId: string | null
  system: boolean
  // Null when there is no source to capture: then only the microphone records.
  systemSourceId: string | null
  // For the queue job.
  title: string
  model: string | null
  language: string | null
}

// What MediaRecorder offers here.
export interface Recorder {
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  start(timeslice: number): void
  stop(): void
}

// The microphone goes through an audio graph into the stream the recorder takes.
export interface AudioGraph {
  stream: MediaStream
  close(): void
}

type RecordingApi = Pick<ApiClient, 'startQueueRecording' | 'stopQueueRecording' | 'startCapture' | 'stopCapture' | 'uploadRecording' | 'addQueueJob'>

export type SessionDeps = {
  api: RecordingApi
  platform: () => Promise<string>
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  connect: (mic: MediaStream) => AudioGraph
  createRecorder: (stream: MediaStream) => Recorder
}

export const MIC_TYPE = 'audio/webm;codecs=opus'
// The recorder hands over a chunk a second, so a long recording is not one buffer.
const CHUNK_MS = 1000

export type LiveRecording = {
  // Stops, saves and queues the recording; the queue is let go in every case. Throws
  // what went wrong. A second call waits for the first.
  stop(): Promise<void>
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

// The browser's own audio, for the app.
export function browserDeps(api: RecordingApi, platform: () => Promise<string>): SessionDeps {
  return {
    api,
    platform,
    getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
    connect: mic => {
      const context = new AudioContext()
      const destination = context.createMediaStreamDestination()
      context.createMediaStreamSource(mic).connect(destination)
      return { stream: destination.stream, close: () => { void context.close() } }
    },
    createRecorder: stream => {
      const media = new MediaRecorder(stream, { mimeType: MIC_TYPE })
      const recorder: Recorder = { ondataavailable: null, onstop: null, start: slice => media.start(slice), stop: () => media.stop() }
      media.ondataavailable = event => recorder.ondataavailable?.(event)
      media.onstop = () => recorder.onstop?.()
      return recorder
    },
  }
}

// Resolves once the recording runs; rejects with the reason it could not start,
// after letting go of everything it took.
export async function startRecording(request: RecordingRequest, deps: SessionDeps): Promise<LiveRecording> {
  const { api } = deps
  // Frees the CPU or GPU for the recording: the running transcription stops.
  await api.startQueueRecording().catch(() => {})

  let micStream: MediaStream | null = null
  let graph: AudioGraph | null = null
  let recorder: Recorder | null = null
  let captureJobId: string | null = null
  const chunks: Blob[] = []

  const releaseMic = () => {
    micStream?.getTracks().forEach(track => track.stop())
    graph?.close()
  }

  try {
    const platform = await deps.platform()
    if (request.mic) {
      micStream = await deps.getUserMedia({ audio: request.micDeviceId ? { deviceId: { exact: request.micDeviceId } } : true })
    }
    if (request.system && request.systemSourceId) {
      try {
        captureJobId = await api.startCapture(request.systemSourceId)
      } catch (err) {
        throw new Error(captureStartError(platform, message(err)))
      }
    }
    if (!micStream && !captureJobId) throw new Error('No audio source available. Check device permissions.')
    if (micStream) {
      graph = deps.connect(micStream)
      recorder = deps.createRecorder(graph.stream)
      recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data) }
      recorder.start(CHUNK_MS)
    }
  } catch (err) {
    releaseMic()
    if (captureJobId) api.stopCapture(captureJobId).catch(() => {})
    api.stopQueueRecording().catch(() => {})
    throw err instanceof Error ? err : new Error(message(err))
  }

  // The microphone's file, once the recorder has handed over its last chunk.
  const finishMic = (running: Recorder) => new Promise<string>((resolve, reject) => {
    running.onstop = () => {
      releaseMic()
      api.uploadRecording(new Blob(chunks, { type: MIC_TYPE })).then(resolve, reject)
    }
    running.stop()
  })

  const stopping = async () => {
    try {
      let filePath: string
      if (captureJobId && recorder) {
        const micPath = await finishMic(recorder)
        filePath = await api.stopCapture(captureJobId, micPath)
      } else if (captureJobId) {
        releaseMic()
        filePath = await api.stopCapture(captureJobId)
      } else {
        filePath = await finishMic(recorder!)
      }
      // The new recording joins the end of the queue.
      await api.addQueueJob({ audioPath: filePath, title: request.title, whisperModel: request.model, language: request.language })
    } finally {
      // After the recording was queued: the queue may start again.
      await api.stopQueueRecording().catch(() => {})
    }
  }

  let stopped: Promise<void> | null = null
  return { stop: () => (stopped ??= stopping()) }
}
