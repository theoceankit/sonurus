import createClient from 'openapi-fetch'
import { ApiError, type ApiClient, type SpeakerAssignment, type SpeakerUndo } from './client'
import { watchGpuDownload, type GpuRestartAnswer } from './gpu-events'
import { watchModelDownload } from './model-download-events'
import { connectQueueEvents } from './queue-events'
import type { paths } from './schema.gen'

const API_BASE = 'http://localhost:8000'

type BackendClientOptions = {
  baseUrl?: string
  fetch?: typeof fetch
  WebSocketImpl?: typeof WebSocket
}

type ApiResult<T> = { data?: T; error?: unknown; response: Response }

// FastAPI sends detail as a string, or as a list for a request it rejected.
function errorMessage(error: unknown, status: number): string {
  const detail = (error as { detail?: unknown } | undefined)?.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail) && typeof detail[0]?.msg === 'string') return detail[0].msg
  return `Server error ${status}`
}

async function send<T>(request: Promise<ApiResult<T>>): Promise<T> {
  let result: ApiResult<T>
  try {
    result = await request
  } catch (err) {
    throw new ApiError(0, err instanceof Error ? err.message : String(err))
  }
  if (!result.response.ok) throw new ApiError(result.response.status, errorMessage(result.error, result.response.status))
  return result.data as T
}

export function createBackendClient(options: BackendClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? API_BASE
  const http = createClient<paths>({ baseUrl, fetch: options.fetch })
  const transcript = (transcript_id: number) => ({ params: { path: { transcript_id } } })
  const segment = (transcript_id: number, start: number) => ({ params: { path: { transcript_id, start } } })

  const assignSpeaker = async ({ transcriptId, segmentStarts, target }: SpeakerAssignment) => {
    const speaker = 'id' in target
      ? { speaker_id: target.id }
      : { speaker_name: target.name, ...(target.colorIndex != null ? { color_index: target.colorIndex } : {}) }
    const { speaker_id: speakerId } = await send(http.POST('/transcripts/{transcript_id}/speaker-assignments', {
      ...transcript(transcriptId),
      body: { segment_starts: [...segmentStarts], ...speaker },
    }))
    return { speakerId }
  }

  const undoSpeakerAssignment = ({ transcriptId, segmentStarts, speakerId, createdSpeakerId }: SpeakerUndo) =>
    send(http.POST('/transcripts/{transcript_id}/speaker-assignments/undo', {
      ...transcript(transcriptId),
      body: {
        segment_starts: [...segmentStarts],
        speaker_id: speakerId,
        ...(createdSpeakerId ? { created_speaker_id: createdSpeakerId } : {}),
      },
    }))

  return {
    now: () => new Date(),
    listTranscripts: () => send(http.GET('/transcripts')),
    getTranscript: id => send(http.GET('/transcripts/{transcript_id}', transcript(id))),
    getAudioUrl: ({ id, audio_path }) => (audio_path ? `${baseUrl}/transcripts/${id}/audio` : null),
    getWaveform: async (transcript_id, query) => (
      await send(http.GET('/transcripts/{transcript_id}/waveform', { params: { path: { transcript_id }, query } }))
    ).levels,
    updateTranscriptTitle: (id, title) => send(http.PATCH('/transcripts/{transcript_id}', { ...transcript(id), body: { title } })),
    markTranscriptOpened: id => send(http.POST('/transcripts/{transcript_id}/opened', transcript(id))),
    deleteTranscript: id => send(http.DELETE('/transcripts/{transcript_id}', transcript(id))),
    updateSegmentText: (id, start, text) => send(http.PATCH('/transcripts/{transcript_id}/segments/{start}/text', { ...segment(id, start), body: { text } })),
    deleteSegment: (id, start) => send(http.DELETE('/transcripts/{transcript_id}/segments/{start}', segment(id, start))),
    assignSpeaker,
    undoSpeakerAssignment,
    getSpeakerCandidates: id => send(http.GET('/transcripts/{transcript_id}/speaker-candidates', transcript(id))),
    listSpeakers: () => send(http.GET('/speakers')),
    updateSpeaker: (speaker_id, body) => send(http.PATCH('/speakers/{speaker_id}', { params: { path: { speaker_id } }, body })),
    getSpeakerSample: (speaker_id, transcript_id) => send(http.GET('/speakers/{speaker_id}/sample', {
      params: { path: { speaker_id }, query: { transcript_id } },
    })),
    listSpeakerTranscripts: speaker_id => send(http.GET('/speakers/{speaker_id}/transcripts', { params: { path: { speaker_id } } })),
    deleteSpeaker: speaker_id => send(http.DELETE('/speakers/{speaker_id}', { params: { path: { speaker_id } } })),
    getRecordingAudioUrl: id => `${baseUrl}/transcripts/${id}/audio`,
    listModels: () => send(http.GET('/models')),
    startModelDownload: async (model_id, hfToken) => {
      // The schema leaves the answer untyped: it is { job_id }.
      const answer = await send(http.POST('/models/{model_id}/download', { params: { path: { model_id } }, body: { hf_token: hfToken } }))
      return (answer as { job_id: string }).job_id
    },
    cancelModelDownload: async (model_id, job_id) => {
      await send(http.DELETE('/models/{model_id}/download/{job_id}', { params: { path: { model_id, job_id } } }))
    },
    deleteModel: async model_id => { await send(http.DELETE('/models/{model_id}', { params: { path: { model_id } } })) },
    watchModelDownload: (jobId, listener) => watchModelDownload(
      `${baseUrl.replace(/^http/, 'ws')}/ws/models/${jobId}`, listener, options.WebSocketImpl,
    ),
    getGpuStatus: () => send(http.GET('/gpu')),
    startGpuDownload: async () => {
      // The schema leaves the answer untyped: it is { job_id }.
      const answer = await send(http.POST('/gpu/download'))
      return (answer as { job_id: string }).job_id
    },
    cancelGpuDownload: async job_id => { await send(http.DELETE('/gpu/download/{job_id}', { params: { path: { job_id } } })) },
    watchGpuDownload: (jobId, listener) => watchGpuDownload(`${baseUrl.replace(/^http/, 'ws')}/ws/gpu/${jobId}`, listener, options.WebSocketImpl),
    removeGpuPack: async () => { await send(http.DELETE('/gpu/pack')) },
    requestGpuRestart: async () => (await send(http.POST('/gpu/restart'))) as GpuRestartAnswer,
    resetData: () => send(http.POST('/data/reset')),
    getQueue: () => send(http.GET('/queue')),
    startQueue: () => send(http.POST('/queue/start')),
    pauseQueue: () => send(http.POST('/queue/pause')),
    reorderQueue: jobIds => send(http.PUT('/queue/order', { body: { job_ids: [...jobIds] } })),
    deleteQueueJob: async job_id => {
      await send(http.DELETE('/queue/jobs/{job_id}', { params: { path: { job_id } } }))
    },
    addQueueJob: ({ audioPath, whisperModel, language, title }) => send(http.POST('/queue/jobs', {
      body: { audio_path: audioPath, whisper_model: whisperModel, language, ...(title ? { title } : {}) },
    })),
    updateQueueJob: (job_id, body) => send(http.PATCH('/queue/jobs/{job_id}', { params: { path: { job_id } }, body })),
    retryQueueJob: job_id => send(http.POST('/queue/jobs/{job_id}/retry', { params: { path: { job_id } } })),
    setQueueStartMode: start_mode => send(http.PUT('/queue/settings', { body: { start_mode } })),
    subscribeQueueEvents: (listener, onConnection) => connectQueueEvents({
      url: `${baseUrl.replace(/^http/, 'ws')}/ws/queue`,
      onEvent: listener,
      onConnection,
      WebSocketImpl: options.WebSocketImpl,
    }),
  }
}
