import type { GpuDownloadEvent } from '../gpu-events'
import { ApiError, type ApiClient, type SpeakerAssignment, type SpeakerUndo } from '../client'
import { effectiveSpeaker, UNASSIGNED, type AudioSource, type GpuStatus, type ModelInfo, type QueueJob, type QueueSnapshot, type QueueUpdate, type Segment, type Speaker, type SpeakerCandidates } from '../types'
import { BOARDS, type FixtureBoard, type FixtureData } from './boards'
import { FIXTURE_GPU, FIXTURE_NOW, GONE_AUDIO_IDS, queueSnapshot } from './data'
import { fixtureModels } from './models'
import type { EventScript } from './event-scripts'
import type { ModelDownloadEvent } from '../model-download-events'
import type { DownloadFailure } from '../../transcribe/download-errors'
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
  // fails at the end with downloadFails: with that code, a timeout (network) for true.
  // The GPU download fails with it too.
  downloadStepMs?: number
  downloadFails?: boolean | DownloadFailure
  // What GET /gpu says; a packaged Linux app with an RTX 4060 and nothing installed by
  // default. The CUDA download goes as model downloads do, then waits for a restart,
  // which the fixtures apply as soon as the app may restart.
  gpu?: Partial<GpuStatus>
  // The system audio sources; FIXTURE_CAPTURE_SOURCES by default, none for a computer
  // where nothing can be captured.
  captureSources?: readonly AudioSource[]
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

// What the backend says for each code: the exception as raised, and the code.
const DOWNLOAD_ERRORS: Record<DownloadFailure, string> = {
  no_token: 'GatedRepoError: 401 Client Error. Cannot access gated repo pyannote/speaker-diarization-community-1.',
  no_access: 'GatedRepoError: 403 Client Error. Cannot access gated repo pyannote/speaker-diarization-community-1.',
  network: 'LocalEntryNotFoundError: Connection to huggingface.co timed out',
  failed: 'OSError: [Errno 28] No space left on device',
}
const downloadError = (code: DownloadFailure) => ({ type: 'error' as const, message: DOWNLOAD_ERRORS[code], code })

// The sources of a Linux desktop with HDMI and Bluetooth headphones.
export const FIXTURE_CAPTURE_SOURCES: readonly AudioSource[] = [
  { id: '@DEFAULT_MONITOR@', label: 'System audio (default)' },
  { id: 'alsa_output.pci-0000_01_00.1.hdmi-stereo.monitor', label: 'AD107 High Definition Audio Controller Digital Stereo (HDMI) [SAMSUNG]' },
  { id: 'bluez_output.58_18_62_38_72_FA.1.monitor', label: 'WH-1000XM5' },
]

// A source whose capture the backend refuses, as when parec is missing.
export const BROKEN_SOURCE = 'broken.monitor'
export const BROKEN_SOURCE_ERROR = 'System audio capture needs parec. Install pulseaudio-utils and try again.'

const RECORDINGS_DIR = '/home/me/.config/sonorus/recordings'

const EMPTY: FixtureData = { transcripts: [], details: [], speakers: [], candidates: {} }

// The same interface as the backend client, on data kept in memory. Each client
// has its own copy, so stories and tests do not see each other's changes.
export function createFixtureClient({
  scenario = 'default', board = 'review', noAudio = false, noModels = false, installedModels,
  downloadStepMs = 400, downloadFails = false, gpu: gpuStatus = {}, captureSources = FIXTURE_CAPTURE_SOURCES, overrides = {},
}: FixtureOptions = {}): FixtureClient {
  const captures = new Set<string>()
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

  // A recording of the list has segments only when it is one of the details; for the
  // others, one turn of each of its speakers, so their samples and stats are there too.
  const recordingSegments = (id: number): Segment[] => {
    const detail = data.details.find(t => t.id === id)
    if (detail) return detail.segments
    const item = listItem(id)
    if (!item) throw new ApiError(404, 'Transcript not found')
    return item.speakers.map((speakerId, i) => ({
      start: i * 6, end: i * 6 + 5, text: `Something said in "${item.title}".`,
      speaker_raw: `SPEAKER_0${i}`, speaker_resolved: speakerId, speaker_final: null, unassigned: false,
    }))
  }
  const hasAudio = (id: number) => !noAudio && !GONE_AUDIO_IDS.includes(id)

  const speakerTranscripts = (speakerId: string) => {
    speaker(speakerId)
    return data.transcripts.flatMap(item => {
      const own = recordingSegments(item.id).filter(s => effectiveSpeaker(s) === speakerId)
      if (own.length === 0) return []
      return [{
        id: item.id, title: item.title, created_at: item.created_at, segments: own.length,
        duration_sec: own.reduce((sum, s) => sum + s.end - s.start, 0), has_audio: hasAudio(item.id),
      }]
    })
  }

  const deleteSpeaker = (speakerId: string) => {
    speaker(speakerId)
    if (queue.running_job_id) throw new ApiError(409, 'A transcription is in progress')
    if (queue.recording) throw new ApiError(409, 'A recording is in progress')
    let segments = 0
    const touched = new Set<number>()
    for (const t of data.details) {
      for (const s of t.segments) {
        if (effectiveSpeaker(s) !== speakerId) continue
        s.speaker_resolved = null
        s.speaker_final = null
        s.unassigned = true
        segments++
        touched.add(t.id)
      }
      delete data.candidates[t.id]?.[speakerId]
    }
    for (const item of data.transcripts) {
      if (!item.speakers.includes(speakerId)) continue
      if (!data.details.some(t => t.id === item.id)) {
        segments++
        touched.add(item.id)
      }
      item.speakers = item.speakers.filter(id => id !== speakerId)
    }
    data.speakers = data.speakers.filter(s => s.id !== speakerId)
    return { segments, transcripts: touched.size }
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
        if (downloadFails) return endDownload(jobId, downloadError(downloadFails === true ? 'network' : downloadFails))
        model.installed = true
        endDownload(jobId, { type: 'done' })
      }, downloadStepMs),
    }
    downloads.set(jobId, download)
    return jobId
  }

  let gpu: GpuStatus = { ...FIXTURE_GPU, ...gpuStatus }
  type GpuJob = { id: string; pct: number; timer: ReturnType<typeof setInterval>; listeners: Set<(event: GpuDownloadEvent) => void> }
  let gpuJob: GpuJob | null = null
  const endGpuJob = (event: GpuDownloadEvent) => {
    const job = gpuJob
    if (!job) return
    clearInterval(job.timer)
    gpuJob = null
    gpu = { ...gpu, state: event.type === 'done' ? 'pending_restart' : gpu.state === 'downloading' ? 'not_installed' : gpu.state, pending: event.type === 'done' ? 'install' : gpu.pending }
    job.listeners.forEach(listener => listener(event))
  }
  const startGpuJob = () => {
    if (gpu.blocked_reason) throw new ApiError(409, gpu.blocked_reason)
    if (gpuJob) throw new ApiError(409, 'already_downloading')
    if (gpu.state === 'active' || gpu.state === 'pending_restart') throw new ApiError(409, 'installed')
    const job: GpuJob = {
      id: crypto.randomUUID(), pct: 0, listeners: new Set(),
      timer: setInterval(() => {
        if (job.pct >= 100) {
          if (downloadFails) return endGpuJob({ type: 'error', message: 'Not enough disk space: 11.8 GB needed, 5.0 GB free' })
          return endGpuJob({ type: 'done' })
        }
        job.pct = Math.min(100, job.pct + 25)
        job.listeners.forEach(listener => listener(job.pct < 100 ? { type: 'progress', phase: 'download', pct: job.pct } : { type: 'progress', phase: 'install' }))
      }, downloadStepMs),
    }
    gpuJob = job
    gpu = { ...gpu, state: 'downloading' }
    return job.id
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
      // The recordings with all their segments first, as before the others had any.
      const ids = [...new Set([...data.details.map(t => t.id), ...data.transcripts.map(t => t.id)])]
      const source = ids.map(tid => ({ id: tid })).filter(t => (transcriptId === undefined || t.id === transcriptId) && hasAudio(t.id))
      for (const t of source) {
        const found = recordingSegments(t.id).find(s => effectiveSpeaker(s) === id)
        const audioPath = data.details.find(d => d.id === t.id)?.audio_path ?? `/fixtures/${t.id}.wav`
        if (found) return { transcript_id: t.id, audio_path: audioPath, start: found.start, end: found.end, text: found.text }
      }
      throw new ApiError(404, 'No audio available for this speaker')
    }),
    listSpeakerTranscripts: id => answer(() => speakerTranscripts(id)),
    deleteSpeaker: id => answer(() => deleteSpeaker(id)),
    getRecordingAudioUrl: id => {
      if (!hasAudio(id) || !data.transcripts.some(t => t.id === id)) return null
      if (!audioUrls.has(id)) audioUrls.set(id, createTestAudioUrl(recordingSegments(id)))
      return audioUrls.get(id)!
    },
    listModels: () => answer(() => models),
    startModelDownload: modelId => answer(() => startDownload(modelId)),
    resetData: () => answer(() => {
      if (queue.running_job_id) throw new ApiError(409, 'A transcription is in progress')
      const summary = { transcripts: data.transcripts.length, speakers: data.speakers.length, files: data.transcripts.length }
      data.transcripts = []
      data.details = []
      data.speakers = []
      data.candidates = {}
      return summary
    }),
    getGpuStatus: () => answer(() => gpu),
    startGpuDownload: () => answer(startGpuJob),
    cancelGpuDownload: jobId => answer(() => {
      if (gpuJob?.id !== jobId) throw new ApiError(404, `No active GPU download '${jobId}'`)
      endGpuJob({ type: 'cancelled' })
    }),
    watchGpuDownload: (jobId, listener) => {
      if (gpuJob?.id !== jobId) {
        listener({ type: 'error', message: 'Unknown job' })
        return () => {}
      }
      const job = gpuJob
      job.listeners.add(listener)
      return () => job.listeners.delete(listener)
    },
    removeGpuPack: () => answer(() => {
      if (gpuJob) throw new ApiError(409, 'Cancel the download first')
      if (gpu.state === 'pending_restart' && gpu.pending === 'install') gpu = { ...gpu, state: 'not_installed', pending: null }
      else if (gpu.state === 'active' || gpu.state === 'error' || gpu.state === 'stale') gpu = { ...gpu, state: 'pending_restart', pending: 'remove' }
      else throw new ApiError(404, 'No GPU pack installed')
    }),
    requestGpuRestart: () => answer(() => {
      if (gpu.state !== 'pending_restart') throw new ApiError(409, 'Nothing to apply')
      if (queue.running_job_id) return { status: 'waiting' as const, reason: 'transcription' as const }
      // The restart the app asks for next applies the change.
      gpu = gpu.pending === 'remove'
        ? { ...gpu, state: 'not_installed', pending: null, device: 'cpu', torch: '2.8.0+cpu' }
        : { ...gpu, state: 'active', pending: null, device: 'cuda', torch: '2.8.0+cu128' }
      return { status: 'ready' as const }
    }),
    deleteModel: modelId => answer(() => {
      const model = models.find(m => m.id === modelId)
      if (!model) throw new ApiError(422, `Unknown model '${modelId}'`)
      const running = queue.jobs.find(job => job.id === queue.running_job_id)
      if (running && [running.whisper_model, 'diarize', running.language].includes(modelId)) {
        throw new ApiError(409, 'In use by the running transcription')
      }
      if (!model.installed) throw new ApiError(404, `Model "${modelId}" is not installed`)
      model.installed = false
    }),
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
    startQueue: () => answer(() => {
      emit({ ...queue, paused: false, paused_by_recording: false })
      return queue
    }),
    // As in the backend, the running job is stopped and waits again at its place.
    pauseQueue: () => answer(() => {
      emit({
        ...queue,
        paused: true,
        paused_by_recording: false,
        running_job_id: null,
        step: null,
        jobs: queue.jobs.map(j => (j.status === 'running' ? { ...j, status: 'waiting' } : j)),
      })
      return queue
    }),
    reorderQueue: jobIds => answer(() => {
      const current = new Set(queue.jobs.map(j => j.id))
      if (jobIds.length !== current.size || new Set(jobIds).size !== jobIds.length || !jobIds.every(id => current.has(id))) {
        throw new ApiError(400, 'job_ids must list every job in the queue exactly once')
      }
      emit({ ...queue, jobs: jobIds.map(id => queue.jobs.find(j => j.id === id)!) })
      return queue
    }),
    deleteQueueJob: jobId => answer(() => {
      if (!queue.jobs.some(j => j.id === jobId)) throw new ApiError(404, 'Job not found')
      const running = queue.running_job_id === jobId
      emit({
        ...queue,
        ...(running ? { running_job_id: null, step: null } : {}),
        jobs: queue.jobs.filter(j => j.id !== jobId),
      })
    }),
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
    updateQueueJob: (jobId, update) => answer(() => {
      const job = queue.jobs.find(j => j.id === jobId)
      if (!job) throw new ApiError(404, 'Job not found')
      const installed = (id: string) => models.some(model => model.id === id && model.installed)
      if (update.whisper_model && !installed(update.whisper_model)) {
        throw new ApiError(400, `Whisper model "${update.whisper_model}" is not installed. Download it in Settings.`)
      }
      const language = update.language === 'auto' ? null : update.language
      if (language && models.some(model => model.kind === 'alignment' && model.id === language && !model.installed)) {
        throw new ApiError(400, `Alignment model for language "${language}" is not installed. Download it in Settings.`)
      }
      if (job.status === 'running') throw new ApiError(409, 'The job is running; pause the queue to edit it')
      const updated: QueueJob = {
        ...job,
        ...(update.title != null ? { title: update.title } : {}),
        ...(update.whisper_model != null ? { whisper_model: update.whisper_model } : {}),
        ...(update.language !== undefined ? { language } : {}),
      }
      emit({ ...queue, jobs: queue.jobs.map(j => (j.id === jobId ? updated : j)) })
      return updated
    }),
    setQueueStartMode: startMode => answer(() => {
      emit({ ...queue, start_mode: startMode })
      return queue
    }),
    retryQueueJob: jobId => answer(() => {
      const job = queue.jobs.find(j => j.id === jobId)
      if (!job) throw new ApiError(404, 'Job not found')
      if (job.status !== 'failed') throw new ApiError(409, 'Only a failed job can be retried')
      const missing = missingModelError(models, job.whisper_model, job.language)
      if (missing) throw missing
      const waiting: QueueJob = { ...job, status: 'waiting', error: null, error_code: null, error_language: null }
      emit({ ...queue, jobs: [...queue.jobs.filter(j => j.id !== jobId), waiting] })
      return waiting
    }),
    listCaptureSources: () => answer(() => [...captureSources]),
    startCapture: sourceId => answer(() => {
      if (sourceId === BROKEN_SOURCE) throw new ApiError(400, BROKEN_SOURCE_ERROR)
      const job = crypto.randomUUID()
      captures.add(job)
      return job
    }),
    stopCapture: jobId => answer(() => {
      if (!captures.delete(jobId)) throw new ApiError(404, 'Capture job not found')
      return `${RECORDINGS_DIR}/sonorus-rec-${jobId}.wav`
    }),
    uploadRecording: () => answer(() => `${RECORDINGS_DIR}/sonorus-rec-${crypto.randomUUID()}.webm`),
    // As the backend: a recording pauses a running queue and stops its job, and gives
    // back only the pause it made itself.
    startQueueRecording: () => answer(() => {
      emit(queue.paused
        ? { ...queue, recording: true }
        : {
          ...queue,
          recording: true,
          paused: true,
          paused_by_recording: true,
          running_job_id: null,
          step: null,
          jobs: queue.jobs.map(j => (j.status === 'running' ? { ...j, status: 'waiting' } : j)),
        })
      return queue
    }),
    stopQueueRecording: () => answer(() => {
      const resume = queue.paused_by_recording && queue.start_mode === 'auto'
      emit({ ...queue, recording: false, paused_by_recording: false, paused: resume ? false : queue.paused })
      return queue
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
