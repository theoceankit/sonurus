import { act, renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { createKeyStore, followActiveSegment, useIsKey } from './active-segment'
import type { Playback, PlaybackState } from './playback'

const fakePlayback = (initial: Partial<PlaybackState> = {}) => {
  let state: PlaybackState = { currentTime: 0, duration: 60, paused: true, rate: 1, volume: 1, status: 'ready', ...initial }
  const listeners = new Set<() => void>()
  const playback = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  } as unknown as Playback
  const change = (next: Partial<PlaybackState>) => {
    state = { ...state, ...next }
    listeners.forEach(listener => listener())
  }
  return { playback, change, listeners }
}

const SEGMENTS = [{ start: 0, end: 5 }, { start: 5, end: 8 }, { start: 10, end: 12 }]

test('key store: a listener hears only a real change', () => {
  const store = createKeyStore<number | null>(null)
  const listener = vi.fn()
  store.subscribe(listener)
  store.set(null)
  expect(listener).not.toHaveBeenCalled()
  store.set(1)
  expect(listener).toHaveBeenCalledOnce()
})

test('useIsKey: only rows whose answer changed render', () => {
  const store = createKeyStore<number | null>(1)
  const renders = { first: 0, second: 0, third: 0 }
  renderHook(() => { renders.first++; return useIsKey(store, 1) })
  renderHook(() => { renders.second++; return useIsKey(store, 2) })
  renderHook(() => { renders.third++; return useIsKey(store, 3) })
  act(() => store.set(2))
  expect(renders).toEqual({ first: 2, second: 2, third: 1 })
})

test('nothing is active until the audio has moved', () => {
  const { playback, change } = fakePlayback()
  const store = createKeyStore<number | null>(null)
  followActiveSegment(playback, SEGMENTS, store)
  expect(store.get()).toBeNull()
  change({ paused: false })
  expect(store.get()).toBe(0)
})

test('a seek while paused counts as moving', () => {
  const { playback, change } = fakePlayback()
  const store = createKeyStore<number | null>(null)
  followActiveSegment(playback, SEGMENTS, store)
  change({ currentTime: 6 })
  expect(store.get()).toBe(5)
})

test('ticks inside one segment wake nobody', () => {
  const { playback, change } = fakePlayback({ currentTime: 1, paused: false })
  const store = createKeyStore<number | null>(null)
  followActiveSegment(playback, SEGMENTS, store)
  const listener = vi.fn()
  store.subscribe(listener)
  change({ currentTime: 2 })
  change({ currentTime: 3 })
  change({ currentTime: 4.9 })
  expect(listener).not.toHaveBeenCalled()
  change({ currentTime: 5 })
  expect(listener).toHaveBeenCalledOnce()
})

test('a pause between segments marks nothing', () => {
  const { playback, change } = fakePlayback({ currentTime: 7, paused: false })
  const store = createKeyStore<number | null>(null)
  followActiveSegment(playback, SEGMENTS, store)
  change({ currentTime: 9 })
  expect(store.get()).toBeNull()
})

test('a new source starts without a mark again', () => {
  const { playback, change } = fakePlayback({ currentTime: 6, paused: false })
  const store = createKeyStore<number | null>(null)
  followActiveSegment(playback, SEGMENTS, store)
  expect(store.get()).toBe(5)
  change({ status: 'loading', currentTime: 0, paused: true })
  expect(store.get()).toBeNull()
  change({ status: 'ready' })
  expect(store.get()).toBeNull()
})

test('stopping lets go of the playback', () => {
  const { playback, listeners } = fakePlayback()
  const stop = followActiveSegment(playback, SEGMENTS, createKeyStore<number | null>(null))
  expect(listeners.size).toBe(1)
  stop()
  expect(listeners.size).toBe(0)
})
