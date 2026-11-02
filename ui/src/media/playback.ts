import { useEffect, useState, useSyncExternalStore } from 'react'

export type PlaybackStatus = 'empty' | 'loading' | 'ready' | 'error'

export interface PlaybackState {
  currentTime: number
  duration: number
  paused: boolean
  rate: number
  volume: number
  status: PlaybackStatus
}

export interface Playback {
  getState(): PlaybackState
  subscribe(listener: () => void): () => void
  load(src: string | null): void
  toggle(): void
  seek(seconds: number): void
  setRate(rate: number): void
  setVolume(volume: number): void
}

const EVENTS = [
  'durationchange', 'emptied', 'ended', 'pause', 'play', 'ratechange', 'seeked', 'seeking', 'timeupdate', 'volumechange',
]

// One audio element and its state, kept apart from any component: the player, a
// clip and the transcript can all follow it, each for what it needs.
export function createPlayback(audio: HTMLAudioElement = new Audio()): Playback {
  const listeners = new Set<() => void>()
  let status: PlaybackStatus = 'empty'

  const read = (): PlaybackState => ({
    currentTime: audio.currentTime,
    duration: audio.duration,
    paused: audio.paused,
    rate: audio.playbackRate,
    volume: audio.volume,
    status,
  })

  let state = read()
  const update = () => {
    state = read()
    listeners.forEach(listener => listener())
  }
  const setStatus = (next: PlaybackStatus) => {
    status = next
    update()
  }

  EVENTS.forEach(type => audio.addEventListener(type, update))
  audio.addEventListener('loadedmetadata', () => setStatus('ready'))
  audio.addEventListener('error', () => { if (status !== 'empty') setStatus('error') })

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load(src) {
      if (src) {
        audio.src = src
        setStatus('loading')
      } else if (status !== 'empty') {
        audio.pause()
        audio.removeAttribute('src')
        status = 'empty'
        audio.load()
        update()
      }
    },
    toggle() {
      if (audio.paused) audio.play().catch(() => {})
      else audio.pause()
    },
    seek(seconds) {
      if (status !== 'ready') return
      audio.currentTime = seconds
      update()
    },
    setRate(rate) {
      // Loading a source goes back to the default rate.
      audio.defaultPlaybackRate = rate
      audio.playbackRate = rate
      update()
    },
    setVolume(volume) {
      audio.volume = volume
      audio.muted = volume === 0
      update()
    },
  }
}

const whole = (state: PlaybackState) => state

// Renders only when what the selector returns changes.
export function usePlayback(playback: Playback): PlaybackState
export function usePlayback<T>(playback: Playback, selector: (state: PlaybackState) => T): T
export function usePlayback(playback: Playback, selector: (state: PlaybackState) => unknown = whole) {
  return useSyncExternalStore(playback.subscribe, () => selector(playback.getState()))
}

// A playback for one component's lifetime, on the given source.
export function useAudioPlayback(src: string | null): Playback {
  const [playback] = useState(() => createPlayback())
  useEffect(() => {
    playback.load(src)
    return () => playback.load(null)
  }, [playback, src])
  return playback
}
