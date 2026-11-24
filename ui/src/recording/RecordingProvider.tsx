import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApi } from '../api/ApiProvider'
import { queryKeys, useQueue } from '../api/queries'
import type { LiveRecording, QueueSnapshot } from '../api/types'
import { toast } from '../components/Toast/toast-store'
import { captureStartError } from './sources'

// The backend records: the microphone and system audio, one process per track, and
// queues the recording when it stops. A window only starts, shows and stops it, so a
// recording goes on when its window is closed, and a new window shows it from the queue
// snapshot (useQueueEventsSync keeps that up; the app's root has it).

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
  // Off: no speakers. On unless said.
  diarize?: boolean
}

// starting and stopping are the time the backend takes.
export type RecordingPhase = 'idle' | 'starting' | 'live' | 'stopping'

export type RecordingState = {
  phase: RecordingPhase
  // The title the recording is queued with.
  title: string
  // When it started recording, by Date.now(); null until then.
  startedAt: number | null
}

type RecordingControl = RecordingState & {
  start: (request: RecordingRequest) => void
  stop: () => void
}

const IDLE: RecordingState = { phase: 'idle', title: '', startedAt: null }

// Without a provider (a screen alone in a story or a test) nothing records.
const RecordingContext = createContext<RecordingControl>({ ...IDLE, start: () => {}, stop: () => {} })

export const useRecording = () => useContext(RecordingContext)

const platform = async () => (await window.electronAPI?.getPlatform?.().catch(() => '')) ?? ''

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

const stateOf = (recording: LiveRecording): RecordingState => ({
  phase: recording.phase,
  title: recording.title,
  // The backend's clock is Unix time in seconds, on this same machine.
  startedAt: recording.started_at === null ? null : recording.started_at * 1000,
})

interface RecordingProviderProps {
  children: ReactNode
  // A recording already running, for a story.
  initial?: RecordingState
}

// The one live recording of the app. Above the screens, so it shows while the user
// moves between them.
export function RecordingProvider({ children, initial = IDLE }: RecordingProviderProps) {
  const api = useApi()
  const queries = useQueryClient()
  const live = useQueue().data?.recording ?? null
  // Until the backend answers: the start asked for, or a Stop pressed.
  const [starting, setStarting] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)

  const state: RecordingState = live
    ? { ...stateOf(live), ...(stopping && live.phase === 'live' ? { phase: 'stopping' } : {}) }
    : starting !== null ? { phase: 'starting', title: starting, startedAt: null } : initial
  const phase = useRef(state.phase)
  phase.current = state.phase

  // A Stop pressed is done with once that recording has ended; a start once it shows.
  useEffect(() => {
    if (!live) setStopping(false)
    else setStarting(null)
  }, [live])

  // The answer of the backend is shown at once; the snapshot it also sends says the same.
  const show = useCallback((recording: LiveRecording) => {
    if (queries.getQueryData(queryKeys.queue)) {
      queries.setQueryData<QueueSnapshot>(queryKeys.queue, queue => (queue ? { ...queue, recording } : queue))
    } else {
      void queries.invalidateQueries({ queryKey: queryKeys.queue })
    }
  }, [queries])

  const start = useCallback((request: RecordingRequest) => {
    if (phase.current !== 'idle') return
    phase.current = 'starting'
    setStarting(request.title)
    api.startRecording({
      mic: request.mic,
      mic_device: request.micDeviceId,
      system: request.system,
      system_source: request.systemSourceId,
      title: request.title,
      whisper_model: request.model,
      language: request.language,
      diarize: request.diarize ?? true,
    }).then(
      show,
      async err => {
        setStarting(null)
        toast({ message: `Could not start recording: ${captureStartError(await platform(), message(err))}`, type: 'error' })
      },
    )
  }, [api, show])

  const stop = useCallback(() => {
    if (phase.current !== 'live') return
    phase.current = 'stopping'
    setStopping(true)
    api.stopRecording().then(show, err => {
      setStopping(false)
      toast({ message: `Recording error: ${message(err)}`, type: 'error' })
    })
  }, [api, show])

  const control = useMemo(() => ({ ...state, start, stop }), [state.phase, state.title, state.startedAt, start, stop])
  return <RecordingContext.Provider value={control}>{children}</RecordingContext.Provider>
}

// Whole seconds since the recording started, counted again from its start each tick
// so that a late timer never adds up.
export function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt === null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000))
}
