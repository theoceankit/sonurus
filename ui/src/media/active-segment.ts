import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { Playback } from './playback'
import { activeSegmentIndex } from './timeline'

// One value that many rows watch, each only for "is it me?". Setting it wakes the
// rows, and only those whose answer changed render.
export interface KeyStore<K> {
  get(): K
  set(key: K): void
  subscribe(listener: () => void): () => void
}

export function createKeyStore<K>(initial: K): KeyStore<K> {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set(key) {
      if (key === current) return
      current = key
      listeners.forEach(listener => listener())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export const useKey = <K>(store: KeyStore<K>) => useSyncExternalStore(store.subscribe, store.get)

export const useIsKey = <K>(store: KeyStore<K>, key: K) => useSyncExternalStore(store.subscribe, () => store.get() === key)

// Keeps the store on the start of the segment playing, so it stays quiet between
// segments however often the time changes. Nothing is playing until the audio has
// moved: a recording just opened at 0:00 marks no row.
export function followActiveSegment(
  playback: Playback,
  segments: readonly { start: number; end: number }[],
  store: KeyStore<number | null>,
): () => void {
  let moved = false
  const update = () => {
    const { currentTime, paused, status } = playback.getState()
    if (status !== 'ready') moved = false
    else if (currentTime > 0 || !paused) moved = true
    if (!moved) return store.set(null)
    const index = activeSegmentIndex(segments, currentTime)
    store.set(index < 0 ? null : segments[index].start)
  }
  update()
  return playback.subscribe(update)
}

export function useActiveSegment(playback: Playback, segments: readonly { start: number; end: number }[]) {
  const store = useMemo(() => createKeyStore<number | null>(null), [])
  useEffect(() => followActiveSegment(playback, segments, store), [playback, segments, store])
  return store
}
