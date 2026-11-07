import { ApiError, type ApiClient, type SpeakerAssignment, type SpeakerUndo } from '../client'
import { effectiveSpeaker, UNASSIGNED, type ModelInfo, type QueueJob, type QueueSnapshot, type QueueUpdate, type Speaker, type SpeakerCandidates } from '../types'
import { BOARDS, type FixtureBoard, type FixtureData } from './boards'
import { FIXTURE_NOW, queueSnapshot } from './data'
import { fixtureModels } from './models'
import type { EventScript } from './event-scripts'
import type { ModelDownloadEvent } from '../model-download-events'
import { createTestAudioUrl } from './test-audio'
import { fixtureLevels } from './waveform'

export type FixtureScenario = 'default' | 'loading' | 'empty' | 'error'

export type FixtureOptions = {
  scenario?: FixtureScenario
  board?: FixtureBoard
  // Recordings with nothing to play.
  noAudio?: boolean
  // No models downloaded: a file for the queue gets the backend's 400.
  noModels?: boolean
  // The ids of the downloaded models, in place of DEFAULT_INSTALLED.
  installedModels?: readonly string[]
  // A model download goes up a quarter every step and then installs the model, or
  // fails at the end with downloadFails.
  downloadStepMs?: number
  downloadFails?: boolean
  // One method behaving differently, e.g. a failing save on a loaded screen.
  overrides?: Partial<ApiClient>
}

export type FixtureClient = ApiClient & {
  // Plays the script from now on. Returns what stops it.
  playEvents(script: EventScript): () => void
  // Loses the connection to the backend or brings it back.
  setConnected(connected: boolean): void
}

// What the backend answers for a job when no models are downloaded.
export const NO_MODELS = 'Diarization model is not installed. Download it in Settings.'

// The backend's 400 for a job whose models are not all downloaded, in its order.
function missingModelError(models: readonly ModelInfo[], whisperModel: string | null, language: string | null): ApiError | null {
  const installed = (id: string) => models.some(model => model.id === id && model.installed)
  if (whisperModel !== null && !installed(whisperModel)) {
    return new ApiError(400, `Whisper model "${whisperModel}" is not installed. Download it in Settings.`)
  }
  if (!installed('diarize')) return new ApiError(400, NO_MODELS)
  const alignment = models.find(model => model.kind === 'alignment' && model.id === language)
  if (alignment && !alignment.installed) {
    return new ApiError(400, `Alignment model for language "${language}" is not installed. Download it in Settings.`)
  }
  return null
}

const EMPTY: FixtureData = { transcripts: [], details: [], speakers: [], candidates: {} }

// The same interface as the backend client, on data kept in memory. Each client
// has its own copy, so stories and tests do not see each other's changes.
export function createFixtureClient({
  scenario = 'default', board = 'review', noAudio = false, noModels = false, installedModels,
  downloadStepMs = 400, downloadFails = false, overrides = {},
}: FixtureOptions = {}): FixtureClient {
  const audioUrls = new Map<number, string>()
  const models = fixtureModels(noModels ? [] : installedModels)
  const data = structuredClone(scenario === 'empty' ? EMPTY : BOARDS[board])
  let queue: QueueSnapshot = queueSnapshot()
  const listeners = new Set<(event: QueueUpdate) => void>()

  // Every call goes through here, so the scenario covers all of them. Results
  // are copies: only the client's own methods change its data.
  const answer = <T>(read: () => T): Promise<T> => {
    if (scenario === 'loading') return new Promise(() => {})
    if (scenario === 'error') return Promise.reject(new ApiError(500, 'Server error 500'))
    try {
      return Promise.resolve(structuredClone(read()))
    } catch (err) {
      return Promise.reject(err)
    }
  }

  const transcript = (id: number) => {
    const found = data.details.find(t => t.id === id)
    if (!found) throw new ApiError(404, 'Transcript not found')
    return found
  }
  const listItem = (id: number) => data.transcripts.find(t => t.id === id)
  const segmentAt = (id: number, start: number) => {
    const found = transcript(id).segments.find(s => s.start === start)
    if (!found) throw new ApiError(404, 'Segment not found')
    return found
  }
  const speaker = (id: string) => {
    const found = data.speakers.find(s => s.id === id)
    if (!found) throw new ApiError(404, 'Speaker not found')
    return found
  }

  const resolveTarget = (target: SpeakerAssignment['target']): string => {
    if ('id' in target) return speaker(target.id).id
    const created: Speaker = {
      id: crypto.randomUUID(),
      name: target.name,
      color_index: target.colorIndex ?? 0,
      segments: 0,
      transcripts: 1,
      duration_sec: 0,
      last_seen: new Date().toISOString(),
    }
    data.speakers.push(created)
    return created.id
  }

  // What the review of a speaker had when the speaker was left with no segments.
  const reviewed = new Map<number, SpeakerCandidates>()

  const assign = (assignment: SpeakerAssignment) => {
    const { transcriptId, segmentStarts, target } = assignment
    // All or none: a segment that is not there changes nothing and creates no one.
    const changed = segmentStarts.map(start => segmentAt(transcriptId, start))
    const speakerId = resolveTarget(target)
    const from = new Set(changed.map(effectiveSpeaker))
    // The backend keeps one speaker per segment: read back, a correction is in
    // speaker_resolved and speaker_final stays null.
    for (const segment of changed) {
      segment.speaker_resolved = speakerId
      segment.speaker_final = null
      segment.unassigned = false
    }
    const left = new Set(transcript(transcriptId).segments.map(effectiveSpeaker))
    const candidates = data.candidates[transcriptId] ?? {}
    // A speaker with no segments left has nothing to review.
    for (const id of from) {
      if (left.has(id) || !candidates[id]) continue
      reviewed.set(transcriptId, { ...reviewed.get(transcriptId), [id]: candidates[id] })
      delete candidates[id]
    }
    const item = listItem(transcriptId)
    if (item) item.speakers = [...left]
    return { speakerId }
  }

  const undo = ({ transcriptId, segmentStarts, speakerId, createdSpeakerId }: SpeakerUndo) => {
    const segments = transcript(transcriptId).segments.filter(segment => segmentStarts.includes(segment.start))
    for (const segment of segments) {
      segment.unassigned = speakerId === UNASSIGNED
      segment.speaker_resolved = speakerId === UNASSIGNED ? null : speakerId
    }
    const before = reviewed.get(transcriptId)?.[speakerId]
    if (before) (data.candidates[transcriptId] ??= {})[speakerId] = before
    const item = listItem(transcriptId)
    if (item) item.speakers = [...new Set(transcript(transcriptId).segments.map(effectiveSpeaker))]
    if (createdSpeakerId && !data.details.some(t => t.segments.some(s => effectiveSpeaker(s) === createdSpeakerId))) {
      data.speakers = data.speakers.filter(s => s.id !== createdSpeakerId)
    }
  }

  const connectionListeners = new Set<(connected: boolean) => void>()

  // Downloads by job, one per model as on the backend; a job is gone once it ended.
  type Download = { modelId: string; pct: number; timer: ReturnType<typeof setInterval>; listeners: Set<(event: ModelDownloadEvent) => void> }
  const downloads = new Map<string, Download>()
  const endDownload = (jobId: string, event: ModelDownloadEvent) => {
    const download = downloads.get(jobId)
    if (!download) return
    clearInterval(download.timer)
    downloads.delete(jobId)
    download.listeners.forEach(listener => listener(event))
  }
  const startDownload = (modelId: string) => {
    const model = models.find(m => m.id === modelId)
    if (!model) throw new ApiError(422, `Unknown model '${modelId}'`)
    const running = [...downloads].find(([, download]) => download.modelId === modelId)
    if (running) return running[0]
    const jobId = crypto.randomUUID()
    const download: Download = {
      modelId, pct: 0, listeners: new Set(),
      timer: setInterval(() => {
        download.pct = Math.min(100, download.pct + 25)
        download.listeners.forEach(listener => listener({ type: 'progress', pct: download.pct }))
        if (download.pct < 100) return
        if (downloadFails) return endDownload(jobId, { type: 'error', message: 'Connection to huggingface.co timed out' })
        model.installed = true
        endDownload(jobId, { type: 'done' })
      }, downloadStepMs),
    }
    downloads.set(jobId, download)
    return jobId
  }

  const emit = (event: QueueUpdate) => {
    if (event.type === 'snapshot') queue = event
    for (const listener of listeners) listener(structuredClone(event))
  }

  const client: ApiClient = {
    now: () => new Date(FIXTURE_NOW),
    listTranscripts: () => answer(() => data.transcripts),
    getTranscript: id => answer(() => transcript(id)),
    getAudioUrl: ({ id, segments }) => {
      if (noAudio) return null
      if (!audioUrls.has(id)) audioUrls.set(id, createTestAudioUrl(segments))
      return audioUrls.get(id)!
    },
    getWaveform: (id, stretch) => answer(() => {
      const found = transcript(id)
      if (noAudio) throw new ApiError(404, 'Audio file not found')
      return fixtureLevels(found.segments, stretch)
    }),
    updateTranscriptTitle: (id, title) => answer(() => {
      transcript(id).title = title
      const item = listItem(id)
      if (item) item.title = title
    }),
    markTranscriptOpened: id => answer(() => {
      transcript(id)
      const item = listItem(id)
      if (item) item.opened = true
    }),
    deleteTranscript: id => answer(() => {
      transcript(id)
      data.details = data.details.filter(t => t.id !== id)
      data.transcripts = data.transcripts.filter(t => t.id !== id)
    }),
    updateSegmentText: (id, start, text) => answer(() => {
      segmentAt(id, start).text = text
    }),
    deleteSegment: (id, start) => answer(() => {
      const found = transcript(id)
      segmentAt(id, start)
      found.segments = found.segments.filter(s => s.start !== start)
    }),
    assignSpeaker: assignment => answer(() => assign(assignment)),
    undoSpeakerAssignment: request => answer(() => undo(request)),
    getSpeakerCandidates: id => answer(() => {
      transcript(id)
      return data.candidates[id] ?? {}
    }),
    listSpeakers: () => answer(() => data.speakers),
    updateSpeaker: (id, update) => answer(() => {
      const found = speaker(id)
      if (update.name != null) found.name = update.name
      if (update.color_index != null) found.color_index = update.color_index
      return found
    }),
    getSpeakerSample: (id, transcriptId) => answer(() => {
      speaker(id)
      const source = data.details.filter(t => transcriptId === undefined || t.id === transcriptId)
      for (const t of source) {
        const found = t.segments.find(s => effectiveSpeaker(s) === id)
        if (found) return { transcript_id: t.id, audio_path: t.audio_path, start: found.start, end: found.end, text: found.text }
      }
      throw new ApiError(404, 'No audio available for this speaker')
    }),
    listModels: () => answer(() => models),
    startModelDownload: modelId => answer(() => startDownload(modelId)),
    cancelModelDownload: (_modelId, jobId) => answer(() => {
      if (!downloads.has(jobId)) throw new ApiError(404, `No active download job '${jobId}'`)
      endDownload(jobId, { type: 'cancelled' })
    }),
    watchModelDownload: (jobId, listener) => {
      const download = downloads.get(jobId)
      if (!download) {
        const unknown = setTimeout(() => listener({ type: 'error', message: 'Unknown job' }), 0)
        return () => clearTimeout(unknown)
      }
      download.listeners.add(listener)
      return () => download.listeners.delete(listener)
    },
    getQueue: () => answer(() => queue),
    addQueueJob: ({ audioPath, whisperModel, language, title }) => answer(() => {
      const missing = missingModelError(models, whisperModel, language)
      if (missing) throw missing
      const job: QueueJob = {
        id: crypto.randomUUID(),
        audio_path: audioPath,
        title: title || audioPath.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, ''),
        whisper_model: whisperModel ?? 'large-v3',
        language,
        status: 'waiting',
        error: null,
        error_code: null,
        error_language: null,
        created_at: new Date().toISOString().slice(0, 19),
      }
      emit({ ...queue, jobs: [...queue.jobs, job] })
      return job
    }),
    subscribeQueueEvents: (listener, onConnection) => {
      listeners.add(listener)
      if (onConnection) connectionListeners.add(onConnection)
      // A real connection answers later too, never during the subscribe. Stays
      // silent when the scenario says the backend is not there.
      const hello = scenario === 'default' || scenario === 'empty'
        ? setTimeout(() => listener(structuredClone(queue)), 0)
        : undefined
      return () => {
        clearTimeout(hello)
        listeners.delete(listener)
        if (onConnection) connectionListeners.delete(onConnection)
      }
    },
  }

  return {
    ...client,
    ...overrides,
    setConnected: connected => connectionListeners.forEach(listener => listener(connected)),
    playEvents: script => {
      let timer: ReturnType<typeof setTimeout>
      const play = (index: number) => {
        const step = script.steps[index]
        if (!step) return
        timer = setTimeout(() => {
          if (step.event.type === 'job_done' && script.result) {
            data.transcripts = [structuredClone(script.result.item), ...data.transcripts]
            data.details.push(structuredClone(script.result.transcript))
          }
          emit(step.event)
          play(index + 1)
        }, step.afterMs)
      }
      play(0)
      return () => clearTimeout(timer)
    },
  }
}
