import { useEffect, useState, useSyncExternalStore } from 'react'
import { useAudioPlayback, type Playback } from './playback'

export interface ClipState {
  // Which clip the state is about; null when none is under way.
  key: string | null
  playing: boolean
  progress: number
  ready: boolean
}

export interface ClipPlayback {
  getState(): ClipState
  subscribe(listener: () => void): () => void
  // Starts this clip, or pauses and resumes it if it is the one under way.
  toggle(key: string, start: number, end: number): void
  stop(): void
  dispose(): void
}

// A stretch of the recording played on its own audio element, so the main player
// keeps its place. Only one of the two ever sounds.
export function createClipPlayback(main: Playback, audio: Playback): ClipPlayback {
  const listeners = new Set<() => void>()
  let current: { key: string; start: number; end: number } | null = null
  let state: ClipState = { key: null, playing: false, progress: 0, ready: audio.getState().status === 'ready' }

  const update = () => {
    const { currentTime, paused, status } = audio.getState()
    const next: ClipState = {
      key: current?.key ?? null,
      playing: Boolean(current) && !paused,
      progress: current ? Math.min(1, Math.max(0, (currentTime - current.start) / (current.end - current.start))) : 0,
      ready: status === 'ready',
    }
    if (next.key === state.key && next.playing === state.playing && next.progress === state.progress && next.ready === state.ready) return
    state = next
    listeners.forEach(listener => listener())
  }

  const pause = () => { if (!audio.getState().paused) audio.toggle() }
  const stop = () => {
    current = null
    pause()
    update()
  }

  const stopAudio = audio.subscribe(() => {
    if (current && audio.getState().currentTime >= current.end) stop()
    else update()
  })
  const stopMain = main.subscribe(() => {
    if (current && !main.getState().paused) stop()
  })

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    toggle(key, start, end) {
      if (audio.getState().status !== 'ready') return
      if (current?.key === key && !audio.getState().paused) {
        pause()
        return
      }
      if (current?.key !== key) {
        current = { key, start, end }
        audio.seek(start)
      }
      if (!main.getState().paused) main.toggle()
      if (audio.getState().paused) audio.toggle()
      update()
    },
    stop,
    dispose() {
      stopAudio()
      stopMain()
      stop()
    },
  }
}

// A clip player for one component's lifetime, on the audio of the open recording.
export function useClipPlayback(main: Playback, src: string | null): ClipPlayback {
  const audio = useAudioPlayback(src)
  const [clip, setClip] = useState<ClipPlayback | null>(null)
  useEffect(() => {
    const created = createClipPlayback(main, audio)
    setClip(created)
    return () => created.dispose()
  }, [main, audio])
  return clip ?? IDLE
}

const IDLE_STATE: ClipState = { key: null, playing: false, progress: 0, ready: false }
const IDLE: ClipPlayback = {
  getState: () => IDLE_STATE,
  subscribe: () => () => {},
  toggle() {},
  stop() {},
  dispose() {},
}

export const useClipState = (clip: ClipPlayback) => useSyncExternalStore(clip.subscribe, clip.getState)
