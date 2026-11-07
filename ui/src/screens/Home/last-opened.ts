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

  const remember = useCallback((id: number) => {
    const store = settingsStore()
    const latest = readIds(store.current()?.recentTranscriptIds)
    const next = rememberOpened(latest, id)
    if (next.length === latest.length && next.every((other, i) => other === latest[i])) return
    void store.patch({ recentTranscriptIds: next })
  }, [])

  return { ids, remember }
}
