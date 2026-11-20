import type { GpuDownloadEvent } from '../gpu-events'
import { ApiError, type ApiClient, type SpeakerAssignment, type SpeakerUndo } from '../client'
import { effectiveSpeaker, UNASSIGNED, type AudioSource, type GpuStatus, type LiveRecording, type MicWatch, type RecordingStart, type HandleFormat, type ModelInfo, type QueueJob, type QueueSnapshot, type QueueUpdate, type Segment, type NoteDocument, type Speaker, type SpeakerCandidates } from '../types'
import { BOARDS, type FixtureBoard, type FixtureData } from './boards'
import { FIXTURE_GPU, FIXTURE_NOW, GONE_AUDIO_IDS, queueSnapshot, WEEKLY_SYNC_ID } from './data'
import { weeklySyncNote } from './notes'
import { fixtureModels } from './models'
import type { EventScript } from './event-scripts'
import type { ModelDownloadEvent } from '../model-download-events'
import type { DownloadFailure } from '../../transcribe/download-errors'
import { createTestAudioUrl } from './test-audio'
import { fixtureLevels } from './waveform'
import { baseHandle, uniqueHandle } from './handles'

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
  // The microphones; FIXTURE_MIC_INPUTS by default.
  micInputs?: readonly AudioSource[]
  // What GET /audio/mic-watch says; Linux with pactl by default.
  micWatch?: MicWatch
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

// The microphones of the same desktop; the default one is not listed.
export const FIXTURE_MIC_INPUTS: readonly AudioSource[] = [
  { id: 'alsa_input.usb-046d_C922_Pro_Stream_Webcam-02.iec958-stereo', label: 'C922 Pro Stream Webcam Digital Stereo (IEC958)' },
  { id: 'alsa_input.usb-Maono_PD300X-00.analog-stereo', label: 'Maono Dynamic Microphone Analog Stereo' },
]

// A source whose capture the backend refuses, as when parec is missing.
export const BROKEN_SOURCE = 'broken.monitor'
export const BROKEN_SOURCE_ERROR = 'System audio capture needs parec. Install pulseaudio-utils and try again.'
// A microphone the backend refuses, as one unplugged since it was listed.
export const BROKEN_MIC = 'alsa_input.unplugged'
export const BROKEN_MIC_ERROR = 'The selected microphone is not available: alsa_input.unplugged. Choose another microphone and try again.'

const RECORDINGS_DIR = '/home/me/.config/sonorus/recordings'
export const FIXTURE_MODELS_DIR = '/home/me/.config/sonorus/.models'

const EMPTY: FixtureData = { transcripts: [], details: [], speakers: [], candidates: {} }

const readAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result as string)
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

// The same interface as the backend client, on data kept in memory. Each client
// has its own copy, so stories and tests do not see each other's changes.
export function createFixtureClient({
  scenario = 'default', board = 'review', noAudio = false, noModels = false, installedModels,
  downloadStepMs = 400, downloadFails = false, gpu: gpuStatus = {}, captureSources = FIXTURE_CAPTURE_SOURCES, micInputs = FIXTURE_MIC_INPUTS, micWatch = { available: true, names: true }, overrides = {},
}: FixtureOptions = {}): FixtureClient {
  const audioUrls = new Map<number, string>()
  const models = fixtureModels(noModels ? [] : installedModels)
  // The first download makes the models folder; deleting the models leaves it.
  let modelsFolderMade = false
  const data = structuredClone(scenario === 'empty' ? EMPTY : BOARDS[board])
  let queue: QueueSnapshot = queueSnapshot()
  // Notes by recording: the weekly sync has one, wherever it is.
  const notes = new Map<number, { content: NoteDocument; updated_at: string }>(
    data.details.some(t => t.id === WEEKLY_SYNC_ID) ? [[WEEKLY_SYNC_ID, { content: weeklySyncNote(), updated_at: FIXTURE_NOW.toISOString() }]] : [],
  )
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

  // Speaker handles as the backend keeps them: unique whatever the case, refused with a
  // code, made from the name in the handle format unless set by hand.
  let handleFormat: HandleFormat = 'first.last'
  const takenHandles = (exclude?: string) => data.speakers.flatMap(s => (s.handle && s.id !== exclude ? [s.handle] : []))
  const autoHandle = (name: string, exclude?: string) => uniqueHandle(baseHandle(name, handleFormat), takenHandles(exclude))
  const checkHandle = (text: string, exclude?: string) => {
    const handle = text.trim().replace(/^@+/, '').trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(handle)) {
      throw new ApiError(400, 'Use lowercase Latin letters, digits, dots, hyphens and underscores, up to 32, starting with a letter or a digit.', 'handle_invalid')
    }
    const owner = data.speakers.find(s => s.id !== exclude && s.handle?.toLowerCase() === handle)
    if (owner) throw new ApiError(409, `@${handle} is taken by ${owner.name ?? 'another speaker'}.`, 'handle_taken')
    return handle
  }

  // A handle given is checked before anyone is made.
  const createNamed = (name: string, handle: string | null | undefined, colorIndex: number | null | undefined, transcripts: number): Speaker => {
    const own = handle?.trim() ? checkHandle(handle) : null
    const created: Speaker = {
      id: crypto.randomUUID(),
      name,
      handle: own ?? autoHandle(name),
      handle_manual: own != null,
      color_index: colorIndex ?? 0,
      photo: null,
      segments: 0,
      transcripts,
      duration_sec: 0,
      last_seen: transcripts ? new Date().toISOString() : '',
    }
    data.speakers.push(created)
    return created
  }

  const resolveTarget = (target: SpeakerAssignment['target']): string => {
    if ('id' in target) return speaker(target.id).id
    return createNamed(target.name, target.handle, target.colorIndex, 1).id
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

  // A confirmed possible match waits here for its Undo, as the backend keeps its score.
  const confirmed = new Map<number, SpeakerCandidates>()
  const confirm = (transcriptId: number, speakerId: string) => {
    transcript(transcriptId)
    const answer = data.candidates[transcriptId]?.[speakerId]
    if (confirmed.get(transcriptId)?.[speakerId]) return
    if (!answer?.possible_match) throw new ApiError(404, 'No recognized speaker to confirm')
    confirmed.set(transcriptId, { ...confirmed.get(transcriptId), [speakerId]: answer })
    delete data.candidates[transcriptId][speakerId]
  }
  const unconfirm = (transcriptId: number, speakerId: string) => {
    transcript(transcriptId)
    const answer = confirmed.get(transcriptId)?.[speakerId]
    if (data.candidates[transcriptId]?.[speakerId]?.possible_match) return
    if (!answer) throw new ApiError(404, 'No recognized speaker to confirm')
    delete confirmed.get(transcriptId)![speakerId]
    ;(data.candidates[transcriptId] ??= {})[speakerId] = answer
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

  // As CommitService.merge_speaker(): the segments and possible matches of one
  // speaker go to the other, who takes their name, handle, colour and photo only
  // when they have no name.
  const mergeSpeaker = (speakerId: string, intoId: string) => {
    const from = speaker(speakerId)
    const into = speaker(intoId)
    if (queue.running_job_id) throw new ApiError(409, 'A transcription is in progress')
    if (queue.recording) throw new ApiError(409, 'A recording is in progress')
    if (speakerId === intoId) throw new ApiError(400, 'Choose another speaker to merge into.', 'merge_into_self')
    let segments = 0
    const touched = new Set<number>()
    for (const t of data.details) {
      for (const s of t.segments) {
        if (effectiveSpeaker(s) !== speakerId) continue
        if (s.speaker_final) s.speaker_final = intoId
        else s.speaker_resolved = intoId
        segments++
        touched.add(t.id)
      }
      const candidates = data.candidates[t.id]
      if (candidates?.[speakerId]) {
        if (!candidates[intoId]) candidates[intoId] = candidates[speakerId]
        delete candidates[speakerId]
      }
    }
    let newRecordings = 0
    for (const item of data.transcripts) {
      if (!item.speakers.includes(speakerId)) continue
      if (!data.details.some(t => t.id === item.id)) {
        segments++
        touched.add(item.id)
      }
      if (!item.speakers.includes(intoId)) newRecordings++
      item.speakers = item.speakers.flatMap(id => (id === speakerId ? (item.speakers.includes(intoId) ? [] : [intoId]) : [id]))
    }
    data.speakers = data.speakers.filter(s => s.id !== speakerId)
    if (!into.name && from.name) {
      Object.assign(into, { name: from.name, handle: from.handle, handle_manual: from.handle_manual, color_index: from.color_index, photo: from.photo, photo_url: from.photo_url })
    }
    const lastSeen = [into.last_seen, from.last_seen].filter(Boolean).sort().at(-1) ?? null
    Object.assign(into, {
      segments: into.segments + segments, transcripts: into.transcripts + newRecordings,
      duration_sec: into.duration_sec + from.duration_sec, last_seen: lastSeen,
    })
    return { speaker: into, segments, transcripts: touched.size }
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

  // As the backend: a recording pauses a running queue and stops its job, and gives back
  // only the pause it made itself; when it stops, it is queued first, then let go.
  const startRecording = (request: RecordingStart): LiveRecording => {
    if (queue.recording) throw new ApiError(409, 'A recording is already in progress')
    const whisperModel = request.whisper_model ?? 'large-v3'
    const language = request.language && request.language !== 'auto' ? request.language : null
    const missing = missingModelError(models, whisperModel, language)
    if (missing) throw missing
    if (!request.mic && !request.system) throw new ApiError(400, 'Turn on the microphone or system audio to record.')
    if (request.mic && request.mic_device === BROKEN_MIC) throw new ApiError(400, BROKEN_MIC_ERROR)
    if (request.system && request.system_source === BROKEN_SOURCE) throw new ApiError(400, BROKEN_SOURCE_ERROR)
    const recording: LiveRecording = {
      phase: 'live',
      title: request.title,
      started_at: Date.now() / 1000,
      sources: [...(request.mic ? ['mic' as const] : []), ...(request.system ? ['system' as const] : [])],
    }
    recordingJob = { title: request.title, whisperModel, language }
    emit(queue.paused
      ? { ...queue, recording }
      : {
        ...queue,
        recording,
        paused: true,
        paused_by_recording: true,
        running_job_id: null,
        step: null,
        jobs: queue.jobs.map(j => (j.status === 'running' ? { ...j, status: 'waiting' } : j)),
      })
    return recording
  }
  let recordingJob: { title: string; whisperModel: string; language: string | null } | null = null

  const stopRecording = (): LiveRecording => {
    if (queue.recording?.phase !== 'live' || !recordingJob) throw new ApiError(409, 'No recording is in progress')
    const stopping: LiveRecording = { ...queue.recording, phase: 'stopping' }
    const { title, whisperModel, language } = recordingJob
    recordingJob = null
    emit({ ...queue, recording: stopping })
    setTimeout(() => {
      const job: QueueJob = {
        id: crypto.randomUUID(),
        audio_path: `${RECORDINGS_DIR}/sonorus-rec-${crypto.randomUUID()}.wav`,
        title,
        whisper_model: whisperModel,
        language,
        status: 'waiting',
        error: null,
        error_code: null,
        error_language: null,
        created_at: new Date().toISOString().slice(0, 19),
      }
      const resume = queue.paused_by_recording && queue.start_mode === 'auto'
      emit({ ...queue, jobs: [...queue.jobs, job], recording: null, paused_by_recording: false, paused: resume ? false : queue.paused })
    }, 0)
    return stopping
  }

  const client: ApiClient = {
    now: () => new Date(FIXTURE_NOW),
    listTranscripts: () => answer(() => data.transcripts.map(t => ({ ...t, has_note: notes.has(t.id) }))),
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
    markTranscriptUnopened: id => answer(() => {
      transcript(id)
      const item = listItem(id)
      if (item) item.opened = false
    }),
    deleteTranscript: id => answer(() => {
      transcript(id)
      data.details = data.details.filter(t => t.id !== id)
      data.transcripts = data.transcripts.filter(t => t.id !== id)
      notes.delete(id)
    }),
    getNote: id => answer(() => {
      transcript(id)
      return notes.get(id) ?? { content: null, updated_at: null }
    }),
    saveNote: (id, content) => answer(() => {
      transcript(id)
      notes.set(id, { content: structuredClone(content), updated_at: FIXTURE_NOW.toISOString() })
    }),
    deleteNote: id => answer(() => {
      transcript(id)
      notes.delete(id)
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
    confirmPossibleMatch: (id, speakerId) => answer(() => confirm(id, speakerId)),
    unconfirmPossibleMatch: (id, speakerId) => answer(() => unconfirm(id, speakerId)),
    listSpeakers: () => answer(() => data.speakers),
    createSpeaker: ({ name, handle, color_index }) => answer(() => createNamed(name.trim(), handle, color_index, 0)),
    updateSpeaker: (id, update) => answer(() => {
      const found = speaker(id)
      const handle = update.handle == null ? null : update.handle.trim() ? checkHandle(update.handle, id) : ''
      if (handle != null && !(update.name ?? found.name)) throw new ApiError(400, 'Give the speaker a name first.', 'handle_needs_name')
      if (update.name != null) {
        found.name = update.name
        if (!found.handle_manual) found.handle = autoHandle(update.name, id)
      }
      if (update.color_index != null) found.color_index = update.color_index
      if (handle === '') Object.assign(found, { handle: autoHandle(found.name!, id), handle_manual: false })
      else if (handle != null) Object.assign(found, { handle, handle_manual: true })
      return found
    }),
    getHandleSuggestion: (name, exclude) => answer(() => autoHandle(name, exclude)),
    getHandleFormat: () => answer(() => handleFormat),
    setHandleFormat: format => answer(() => {
      handleFormat = format
      return handleFormat
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
    mergeSpeaker: (id, intoId) => answer(() => mergeSpeaker(id, intoId)),
    // Kept as a data URL, so an img shows it without a server.
    setSpeakerPhoto: async (id, photo) => {
      const url = await readAsDataUrl(photo)
      return answer(() => {
        const found = speaker(id)
        if (!found.name) throw new ApiError(400, 'Give the speaker a name first.', 'photo_needs_name')
        return Object.assign(found, { photo: `${crypto.randomUUID().replaceAll('-', '')}.jpg`, photo_url: url })
      })
    },
    removeSpeakerPhoto: id => answer(() => Object.assign(speaker(id), { photo: null, photo_url: null })),
    getRecordingAudioUrl: id => {
      if (!hasAudio(id) || !data.transcripts.some(t => t.id === id)) return null
      if (!audioUrls.has(id)) audioUrls.set(id, createTestAudioUrl(recordingSegments(id)))
      return audioUrls.get(id)!
    },
    listModels: () => answer(() => models),
    getModelsFolder: () => answer(() => {
      modelsFolderMade ||= models.some(model => model.installed)
      return { path: FIXTURE_MODELS_DIR, exists: modelsFolderMade }
    }),
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
      if (job.status === 'running') throw new ApiError(409, 'This job has started and can no longer be changed.', 'job_running')
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
    listMicInputs: () => answer(() => [...micInputs]),
    getMicWatch: () => answer(() => ({ ...micWatch })),
    startRecording: request => answer(() => startRecording(request)),
    stopRecording: () => answer(() => stopRecording()),
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
