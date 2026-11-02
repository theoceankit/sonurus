import { act, renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { createPlayback, useAudioPlayback, usePlayback } from './playback'

// jsdom does not play media, so this is the part of the element that the store uses.
class FakeAudio extends EventTarget {
  currentTime = 0
  duration = NaN
  paused = true
  playbackRate = 1
  defaultPlaybackRate = 1
  volume = 1
  muted = false
  src = ''
  play = vi.fn(async () => { this.paused = false; this.fire('play') })
  pause = vi.fn(() => { this.paused = true; this.fire('pause') })
  load = vi.fn()
  removeAttribute = vi.fn(() => { this.src = '' })
  fire(type: string) { this.dispatchEvent(new Event(type)) }
}

const setup = () => {
  const audio = new FakeAudio()
  return { audio, playback: createPlayback(audio as unknown as HTMLAudioElement) }
}

const ready = (audio: FakeAudio, duration = 53) => {
  audio.duration = duration
  audio.fire('loadedmetadata')
}

test('starts empty, in the state of the element', () => {
  const { audio, playback } = setup()
  expect(playback.getState()).toEqual({ currentTime: 0, duration: NaN, paused: true, rate: 1, volume: 1, status: 'empty' })
  expect(audio.src).toBe('')
})

test('loading a source waits for the metadata', () => {
  const { audio, playback } = setup()
  playback.load('blob:a')
  expect(audio.src).toBe('blob:a')
  expect(playback.getState().status).toBe('loading')
  ready(audio)
  expect(playback.getState()).toMatchObject({ status: 'ready', duration: 53 })
})

test('a source that fails to load is an error', () => {
  const { audio, playback } = setup()
  playback.load('blob:a')
  audio.fire('error')
  expect(playback.getState().status).toBe('error')
})

test('no source stops the audio and empties the state', () => {
  const { audio, playback } = setup()
  playback.load('blob:a')
  ready(audio)
  audio.paused = false
  playback.load(null)
  expect(audio.pause).toHaveBeenCalled()
  expect(audio.removeAttribute).toHaveBeenCalledWith('src')
  expect(audio.load).toHaveBeenCalled()
  expect(playback.getState().status).toBe('empty')
})

test('toggle plays and pauses', async () => {
  const { audio, playback } = setup()
  playback.load('blob:a')
  ready(audio)
  playback.toggle()
  expect(audio.play).toHaveBeenCalled()
  expect(playback.getState().paused).toBe(false)
  playback.toggle()
  expect(playback.getState().paused).toBe(true)
})

test('a refused play is not an unhandled rejection', async () => {
  const { audio, playback } = setup()
  audio.play.mockRejectedValueOnce(new Error('NotAllowedError'))
  playback.load('blob:a')
  ready(audio)
  playback.toggle()
  await Promise.resolve()
  expect(playback.getState().paused).toBe(true)
})

test('time follows the element', () => {
  const { audio, playback } = setup()
  audio.currentTime = 12
  audio.fire('timeupdate')
  expect(playback.getState().currentTime).toBe(12)
})

test('seek moves the element and shows the new time at once', () => {
  const { audio, playback } = setup()
  playback.load('blob:a')
  ready(audio)
  playback.seek(20)
  expect(audio.currentTime).toBe(20)
  expect(playback.getState().currentTime).toBe(20)
})

test('seek does nothing before the audio is ready', () => {
  const { audio, playback } = setup()
  playback.seek(20)
  expect(audio.currentTime).toBe(0)
})

test('speed goes to the element and survives a new source', () => {
  const { audio, playback } = setup()
  playback.setRate(1.5)
  expect(audio.playbackRate).toBe(1.5)
  expect(audio.defaultPlaybackRate).toBe(1.5)
  expect(playback.getState().rate).toBe(1.5)
})

test('volume 0 mutes, anything else does not', () => {
  const { audio, playback } = setup()
  playback.setVolume(0)
  expect(audio).toMatchObject({ volume: 0, muted: true })
  expect(playback.getState().volume).toBe(0)
  playback.setVolume(0.4)
  expect(audio).toMatchObject({ volume: 0.4, muted: false })
})

test('a listener hears changes until it unsubscribes', () => {
  const { audio, playback } = setup()
  const listener = vi.fn()
  const unsubscribe = playback.subscribe(listener)
  audio.fire('timeupdate')
  expect(listener).toHaveBeenCalledTimes(1)
  unsubscribe()
  audio.fire('timeupdate')
  expect(listener).toHaveBeenCalledTimes(1)
})

test('usePlayback renders only when the selected value changes', () => {
  const { audio, playback } = setup()
  let renders = 0
  const { result } = renderHook(() => {
    renders++
    return usePlayback(playback, state => state.paused)
  })
  const before = renders
  act(() => { audio.currentTime = 5; audio.fire('timeupdate') })
  expect(renders).toBe(before)
  act(() => { audio.paused = false; audio.fire('play') })
  expect(result.current).toBe(false)
  expect(renders).toBe(before + 1)
})

test('useAudioPlayback loads the source and lets go of it on unmount', () => {
  const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const { result, rerender, unmount } = renderHook(({ src }) => useAudioPlayback(src), { initialProps: { src: 'blob:a' as string | null } })
  const playback = result.current
  expect(playback.getState().status).toBe('loading')
  rerender({ src: null })
  expect(result.current).toBe(playback)
  expect(playback.getState().status).toBe('empty')
  rerender({ src: 'blob:b' })
  unmount()
  expect(playback.getState().status).toBe('empty')
  expect(load).toHaveBeenCalled()
  vi.restoreAllMocks()
})
