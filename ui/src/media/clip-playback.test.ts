import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createClipPlayback, type ClipPlayback } from './clip-playback'
import type { Playback, PlaybackState } from './playback'

function fakePlayback(initial: Partial<PlaybackState> = {}) {
  let state: PlaybackState = { currentTime: 0, duration: 60, paused: true, rate: 1, volume: 1, status: 'ready', ...initial }
  const listeners = new Set<() => void>()
  const change = (next: Partial<PlaybackState>) => {
    state = { ...state, ...next }
    listeners.forEach(listener => listener())
  }
  const playback: Playback & { change: typeof change } = {
    change,
    getState: () => state,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    load: vi.fn(),
    toggle: () => change({ paused: !state.paused }),
    seek: (seconds: number) => change({ currentTime: seconds }),
    setRate: vi.fn(),
    setVolume: vi.fn(),
  }
  return playback
}

describe('clip', () => {
  let main: ReturnType<typeof fakePlayback>
  let audio: ReturnType<typeof fakePlayback>
  let clip: ClipPlayback

  beforeEach(() => {
    main = fakePlayback()
    audio = fakePlayback()
    clip = createClipPlayback(main, audio)
  })

  test('plays from its start', () => {
    clip.toggle('a', 16, 20)
    expect(audio.getState()).toMatchObject({ currentTime: 16, paused: false })
    expect(clip.getState()).toMatchObject({ key: 'a', playing: true, progress: 0 })
  })

  test('says how far it has got', () => {
    clip.toggle('a', 16, 20)
    audio.change({ currentTime: 18 })
    expect(clip.getState().progress).toBe(0.5)
  })

  test('stops by itself at its end', () => {
    clip.toggle('a', 16, 20)
    audio.change({ currentTime: 20.1 })
    expect(audio.getState().paused).toBe(true)
    expect(clip.getState()).toMatchObject({ key: null, playing: false, progress: 0 })
  })

  test('stops when the audio ends first', () => {
    clip.toggle('a', 50, 60)
    audio.change({ paused: true })
    audio.change({ currentTime: 60 })
    expect(clip.getState().key).toBe(null)
  })

  test('a second press pauses and a third goes on from there', () => {
    clip.toggle('a', 16, 20)
    audio.change({ currentTime: 18 })
    clip.toggle('a', 16, 20)
    expect(audio.getState().paused).toBe(true)
    expect(clip.getState()).toMatchObject({ key: 'a', playing: false, progress: 0.5 })
    clip.toggle('a', 16, 20)
    expect(audio.getState()).toMatchObject({ currentTime: 18, paused: false })
  })

  test('another clip takes over from its own start', () => {
    clip.toggle('a', 16, 20)
    clip.toggle('b', 30, 33)
    expect(audio.getState()).toMatchObject({ currentTime: 30, paused: false })
    expect(clip.getState().key).toBe('b')
  })

  test('pauses the main player', () => {
    main.change({ paused: false })
    clip.toggle('a', 16, 20)
    expect(main.getState().paused).toBe(true)
  })

  test('leaves a paused main player paused', () => {
    clip.toggle('a', 16, 20)
    expect(main.getState().paused).toBe(true)
  })

  test('the main player starting stops the clip', () => {
    clip.toggle('a', 16, 20)
    main.change({ paused: false })
    expect(audio.getState().paused).toBe(true)
    expect(clip.getState().key).toBe(null)
  })

  test('stop stops it', () => {
    clip.toggle('a', 16, 20)
    clip.stop()
    expect(audio.getState().paused).toBe(true)
    expect(clip.getState().key).toBe(null)
  })

  test('with no audio ready nothing plays', () => {
    audio.change({ status: 'empty' })
    clip.toggle('a', 16, 20)
    expect(audio.getState().paused).toBe(true)
    expect(clip.getState()).toMatchObject({ key: null, ready: false })
  })

  test('tells listeners, and stops following after dispose', () => {
    const listener = vi.fn()
    const unsubscribe = clip.subscribe(listener)
    clip.toggle('a', 16, 20)
    expect(listener).toHaveBeenCalled()
    unsubscribe()
    clip.dispose()
    expect(audio.getState().paused).toBe(true)
    audio.toggle()
    main.change({ paused: false })
    expect(audio.getState().paused).toBe(false)
  })
})
