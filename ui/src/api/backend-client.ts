import createClient from 'openapi-fetch'
import { ApiError, type ApiClient, type SpeakerAssignment } from './client'
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

  const assignSpeaker = ({ transcriptId, target, ...scope }: SpeakerAssignment) => {
    const color = 'colorIndex' in target && target.colorIndex != null ? { color_index: target.colorIndex } : {}
    if ('segmentStart' in scope) {
      return send(http.PATCH('/transcripts/{transcript_id}/segments/{start}/speaker', {
        ...segment(transcriptId, scope.segmentStart),
        body: 'id' in target ? { speaker_id: target.id } : { speaker_name: target.name, ...color },
      }))
    }
    return send(http.POST('/transcripts/{transcript_id}/reassign', {
      ...transcript(transcriptId),
      body: 'id' in target
        ? { from_speaker_id: scope.fromSpeakerId, to_speaker_id: target.id }
        : { from_speaker_id: scope.fromSpeakerId, to_speaker_name: target.name, ...color },
    }))
  }

  return {
    listTranscripts: () => send(http.GET('/transcripts')),
    getTranscript: id => send(http.GET('/transcripts/{transcript_id}', transcript(id))),
    updateTranscriptTitle: (id, title) => send(http.PATCH('/transcripts/{transcript_id}', { ...transcript(id), body: { title } })),
    deleteTranscript: id => send(http.DELETE('/transcripts/{transcript_id}', transcript(id))),
    updateSegmentText: (id, start, text) => send(http.PATCH('/transcripts/{transcript_id}/segments/{start}/text', { ...segment(id, start), body: { text } })),
    deleteSegment: (id, start) => send(http.DELETE('/transcripts/{transcript_id}/segments/{start}', segment(id, start))),
    assignSpeaker,
    getSpeakerCandidates: id => send(http.GET('/transcripts/{transcript_id}/speaker-candidates', transcript(id))),
    listSpeakers: () => send(http.GET('/speakers')),
    updateSpeaker: (speaker_id, body) => send(http.PATCH('/speakers/{speaker_id}', { params: { path: { speaker_id } }, body })),
    getSpeakerSample: (speaker_id, transcript_id) => send(http.GET('/speakers/{speaker_id}/sample', {
      params: { path: { speaker_id }, query: { transcript_id } },
    })),
    getQueue: () => send(http.GET('/queue')),
    subscribeQueueEvents: listener => connectQueueEvents({
      url: `${baseUrl.replace(/^http/, 'ws')}/ws/queue`,
      onEvent: listener,
      WebSocketImpl: options.WebSocketImpl,
    }),
  }
}
