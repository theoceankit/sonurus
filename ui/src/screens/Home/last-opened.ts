import { useCallback, useMemo } from 'react'
import type { TranscriptListItem } from '../../api/types'
import { settingsStore, useSettings } from '../../platform/settings'

// How many recordings the app remembers having opened, newest first.
export const RECENT_LIMIT = 20

// The recording to open when none is: the last one opened that still exists, then
// the one opened before it, and with none of them left the newest, which comes
// first in GET /transcripts. Null only for an empty list.
export function pickRecording(list: readonly TranscriptListItem[], recent: readonly number[]): number | null {
  const existing = recent.find(id => list.some(item => item.id === id))
  return existing ?? list[0]?.id ?? null
}

export function rememberOpened(recent: readonly number[], id: number): number[] {
  return [id, ...recent.filter(other => other !== id)].slice(0, RECENT_LIMIT)
}

// Those still in the list of recordings; the same array when none has gone.
export function pruneRecent(recent: readonly number[], list: readonly TranscriptListItem[]): readonly number[] {
  const kept = recent.filter(id => list.some(item => item.id === id))
  return kept.length === recent.length ? recent : kept
}

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((id, i) => id === b[i])

// A settings file from before the field, or one edited by hand, may hold anything.
const readIds = (value: unknown): number[] => (Array.isArray(value) ? value.filter(id => Number.isInteger(id)) : [])

// The recordings opened last, kept in Electron's settings next to those of the old
// UI, which leaves the field alone. Null until they have been read. Without Electron
// (Storybook, tests) the list starts empty and is kept in memory only.
export function useRecentRecordings() {
  const settings = useSettings()
  const loaded = settings !== null
  // Its own array, so changes of other settings do not make a new list.
  const saved = settings?.recentTranscriptIds
  const ids = useMemo(() => (loaded ? readIds(saved) : null), [loaded, saved])

  // Both change the list as read from the file: before it has been read, they wait
  // for it, or the list written would hold only this change.
  const change = useCallback((update: (recent: readonly number[]) => readonly number[]) => {
    const store = settingsStore()
    void store.read().then(read => {
      const latest = readIds(store.current()?.recentTranscriptIds ?? read.recentTranscriptIds)
      const next = update(latest)
      if (!same(next, latest)) void store.patch({ recentTranscriptIds: [...next] })
    })
  }, [])

  const remember = useCallback((id: number) => change(recent => rememberOpened(recent, id)), [change])
  // Recordings deleted since are forgotten.
  const prune = useCallback((list: readonly TranscriptListItem[]) => change(recent => pruneRecent(recent, list)), [change])

  return { ids, remember, prune }
}
