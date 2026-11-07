import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Playback, PlaybackState } from './playback'
import { createSamplePlayback, SAMPLE_MAX_SECONDS, type SamplePlayback } from './sample-playback'

function fakePlayback(initial: Partial<PlaybackState> = {}) {
  let state: PlaybackState = { currentTime: 0, duration: 60, paused: true, rate: 1, volume: 1, status: 'empty', ...initial }
  const listeners = new Set<() => void>()
  const change = (next: Partial<PlaybackState>) => {
    state = { ...state, ...next }
    listeners.forEach(listener => listener())
  }
  const playback: Playback & { change: typeof change } = {
    change,
    getState: () => state,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    load: vi.fn((src: string | null) => change({ status: src ? 'loading' : 'empty', paused: true })),
    reload: vi.fn(() => change({ status: 'loading' })),
    toggle: () => change({ paused: !state.paused }),
    seek: (seconds: number) => change({ currentTime: seconds }),
    setRate: vi.fn(),
    setVolume: vi.fn(),
  }
  return playback
}

describe('voice samples', () => {
  let main: ReturnType<typeof fakePlayback>
  let audio: ReturnType<typeof fakePlayback>
  let sample: SamplePlayback

  beforeEach(() => {
    main = fakePlayback({ status: 'ready' })
    audio = fakePlayback()
    sample = createSamplePlayback(main, audio)
  })

  test('a sample of a recording waits for it to load, then plays from its start', () => {
    sample.toggle('a', 'one.wav', 16, 20)
    expect(audio.load).toHaveBeenCalledWith('one.wav')
    expect(sample.getState()).toMatchObject({ key: 'a', playing: true })
    expect(audio.getState().paused).toBe(true)
    audio.change({ status: 'ready' })
    expect(audio.getState()).toMatchObject({ currentTime: 16, paused: false })
  })

  test('a sample of the recording already loaded plays at once, and pauses on a second toggle', () => {
    sample.toggle('a', 'one.wav', 16, 20)
    audio.change({ status: 'ready' })
    sample.toggle('a', 'one.wav', 16, 20)
    expect(audio.getState().paused).toBe(true)
    sample.toggle('b', 'one.wav', 30, 32)
    expect(audio.load).toHaveBeenCalledTimes(1)
    expect(audio.getState()).toMatchObject({ currentTime: 30, paused: false })
    expect(sample.getState().key).toBe('b')
  })

  test('another recording stops the sample under way and loads', () => {
    sample.toggle('a', 'one.wav', 16, 20)
    audio.change({ status: 'ready' })
    sample.toggle('b', 'two.wav', 2, 4)
    expect(audio.load).toHaveBeenLastCalledWith('two.wav')
    expect(sample.getState()).toMatchObject({ key: 'b', playing: true })
    audio.change({ status: 'ready' })
    expect(audio.getState()).toMatchObject({ currentTime: 2, paused: false })
  })

  test('is cut to a short preview', () => {
    sample.toggle('a', 'one.wav', 0, 100)
    audio.change({ status: 'ready' })
    audio.change({ currentTime: SAMPLE_MAX_SECONDS + 0.1 })
    expect(audio.getState().paused).toBe(true)
    expect(sample.getState().key).toBeNull()
  })

  test('a recording that fails to load plays nothing, and a toggle again tries it again', () => {
    sample.toggle('a', 'gone.wav', 0, 4)
    audio.change({ status: 'error' })
    expect(sample.getState()).toMatchObject({ key: null, playing: false })
    sample.toggle('a', 'gone.wav', 0, 4)
    expect(audio.reload).toHaveBeenCalled()
  })

  test('nothing to play does nothing', () => {
    sample.toggle('a', null, 0, 4)
    expect(audio.load).not.toHaveBeenCalled()
    expect(sample.getState().key).toBeNull()
  })

  test('pauses the main player, and stops when it plays', () => {
    main.change({ paused: false })
    sample.toggle('a', 'one.wav', 0, 4)
    audio.change({ status: 'ready' })
    expect(main.getState().paused).toBe(true)
    main.change({ paused: false })
    expect(sample.getState().key).toBeNull()
  })

  test('a second toggle while it loads takes it back', () => {
    sample.toggle('a', 'one.wav', 0, 4)
    sample.toggle('a', 'one.wav', 0, 4)
    audio.change({ status: 'ready' })
    expect(audio.getState().paused).toBe(true)
    expect(sample.getState().key).toBeNull()
  })
})
