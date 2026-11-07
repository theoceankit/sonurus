import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApi } from '../api/ApiProvider'
import type { ApiClient } from '../api/client'
import { toast } from '../components/Toast/toast-store'
import { browserDeps, startRecording, type LiveRecording, type RecordingRequest, type SessionDeps } from './session'

// starting and stopping are the time the backend and the microphone take.
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

interface RecordingProviderProps {
  children: ReactNode
  // The audio of the window; tests and stories pass their own.
  deps?: (api: ApiClient) => SessionDeps
  // A recording already running, for a story.
  initial?: RecordingState
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

// The one live recording of the app. Above the screens, so it goes on while the user
// moves between them; the window, not a screen, owns the microphone.
export function RecordingProvider({ children, deps, initial = IDLE }: RecordingProviderProps) {
  const api = useApi()
  const [state, setState] = useState<RecordingState>(initial)
  const live = useRef<LiveRecording | null>(null)
  const phase = useRef(state.phase)
  phase.current = state.phase

  const start = useCallback((request: RecordingRequest) => {
    if (phase.current !== 'idle') return
    phase.current = 'starting'
    setState({ phase: 'starting', title: request.title, startedAt: null })
    startRecording(request, deps ? deps(api) : browserDeps(api, platform)).then(
      recording => {
        live.current = recording
        setState({ phase: 'live', title: request.title, startedAt: Date.now() })
      },
      err => {
        setState(IDLE)
        toast({ message: `Could not start recording: ${message(err)}`, type: 'error' })
      },
    )
  }, [api, deps])

  const stop = useCallback(() => {
    const recording = live.current
    if (phase.current !== 'live' || !recording) return
    live.current = null
    phase.current = 'stopping'
    setState(current => ({ ...current, phase: 'stopping' }))
    recording.stop()
      .catch(err => { toast({ message: `Recording error: ${message(err)}`, type: 'error' }) })
      .finally(() => setState(IDLE))
  }, [])

  const control = useMemo(() => ({ ...state, start, stop }), [state, start, stop])
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
