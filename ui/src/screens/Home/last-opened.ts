import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranscriptListItem } from '../../api/types'
import type { ElectronAPI } from '../../platform/electron-api'

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

const bridge = (): ElectronAPI | undefined => (typeof window === 'undefined' ? undefined : window.electronAPI)

// A settings file from before the field, or one edited by hand, may hold anything.
const readIds = (value: unknown): number[] => (Array.isArray(value) ? value.filter(id => Number.isInteger(id)) : [])

// The recordings opened last, kept in Electron's settings next to those of the old
// UI, which leaves the field alone. Null until they have been read. Without Electron
// (Storybook, tests) the list starts empty and is kept in memory only.
export function useRecentRecordings() {
  const [ids, setIds] = useState<number[] | null>(() => (bridge() ? null : []))
  const latest = useRef<number[]>([])
  const writes = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    const api = bridge()
    if (!api) return
    let current = true
    api.readSettings()
      .then(settings => readIds(settings.recentTranscriptIds), () => [])
      .then(read => {
        if (!current) return
        latest.current = read
        setIds(read)
      })
    return () => { current = false }
  }, [])

  const remember = useCallback((id: number) => {
    const next = rememberOpened(latest.current, id)
    if (next.every((other, i) => other === latest.current[i]) && next.length === latest.current.length) return
    latest.current = next
    setIds(next)
    const api = bridge()
    if (!api) return
    // One at a time, each on what the last one wrote: the settings file is written whole.
    writes.current = writes.current
      .then(() => api.readSettings())
      .then(settings => api.writeSettings({ ...settings, recentTranscriptIds: next }))
      .catch(() => {})
  }, [])

  return { ids, remember }
}
