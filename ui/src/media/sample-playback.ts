import { useEffect, useState, useSyncExternalStore } from 'react'
import { createClipPlayback, type ClipState } from './clip-playback'
import { createPlayback, type Playback } from './playback'

// However long a segment is, its sample is a short preview.
export const SAMPLE_MAX_SECONDS = 15

export interface SampleState {
  // The sample under way, also while its recording loads; null when none is.
  key: string | null
  playing: boolean
  progress: number
}

export interface SamplePlayback {
  getState(): SampleState
  subscribe(listener: () => void): () => void
  // Starts this sample, or pauses and resumes it if it is the one under way. A sample
  // of another recording waits for that recording to load. A null src plays nothing.
  toggle(key: string, src: string | null, start: number, end: number): void
  stop(): void
  dispose(): void
}

const IDLE: SampleState = { key: null, playing: false, progress: 0 }

// Voice samples from any recording, one at a time, on their own audio element: the
// main player keeps its place and pauses while a sample plays.
export function createSamplePlayback(main: Playback, audio: Playback): SamplePlayback {
  const clip = createClipPlayback(main, audio)
  const listeners = new Set<() => void>()
  let src: string | null = null
  let waiting: { key: string; start: number; end: number } | null = null
  let state = IDLE

  const update = () => {
    const clipState: ClipState = clip.getState()
    const next: SampleState = waiting
      ? { key: waiting.key, playing: true, progress: 0 }
      : { key: clipState.key, playing: clipState.playing, progress: clipState.progress }
    if (next.key === state.key && next.playing === state.playing && next.progress === state.progress) return
    state = next
    listeners.forEach(listener => listener())
  }

  const stopClip = clip.subscribe(update)
  const stopAudio = audio.subscribe(() => {
    if (!waiting) return
    const { status } = audio.getState()
    if (status === 'ready') {
      const { key, start, end } = waiting
      waiting = null
      clip.toggle(key, start, end)
    } else if (status === 'error') {
      waiting = null
    }
    update()
  })

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    toggle(key, nextSrc, start, end) {
      if (!nextSrc) return
      const stretch = Math.min(end, start + SAMPLE_MAX_SECONDS)
      if (nextSrc === src && audio.getState().status === 'ready') {
        waiting = null
        clip.toggle(key, start, stretch)
        update()
        return
      }
      if (waiting?.key === key) {
        waiting = null
        update()
        return
      }
      clip.stop()
      waiting = { key, start, end: stretch }
      if (nextSrc !== src) {
        src = nextSrc
        audio.load(nextSrc)
      } else if (audio.getState().status === 'error') {
        audio.reload()
      }
      update()
    },
    stop() {
      waiting = null
      clip.stop()
      update()
    },
    dispose() {
      stopAudio()
      stopClip()
      clip.dispose()
      audio.load(null)
    },
  }
}

// A sample player for one component's lifetime, beside the main player.
export function useSamplePlayback(main: Playback): SamplePlayback {
  const [sample, setSample] = useState<SamplePlayback | null>(null)
  useEffect(() => {
    const created = createSamplePlayback(main, createPlayback())
    setSample(created)
    return () => created.dispose()
  }, [main])
  return sample ?? IDLE_PLAYBACK
}

const IDLE_PLAYBACK: SamplePlayback = {
  getState: () => IDLE,
  subscribe: () => () => {},
  toggle() {},
  stop() {},
  dispose() {},
}

export const useSampleState = (sample: SamplePlayback) => useSyncExternalStore(sample.subscribe, sample.getState)
