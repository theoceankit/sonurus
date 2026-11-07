import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { useApi } from '../api/ApiProvider'
import type { ApiClient } from '../api/client'
import { queryKeys } from '../api/queries'

// The model downloads of the app: one per model, whoever starts it, so every screen
// that shows a model sees the same one. GET /models does not tell of running downloads;
// this does. A download keeps going when the screen that started it closes.

export type DownloadOutcome = 'done' | 'failed' | 'cancelled'

type Entry = { pct: number; jobId: string | null; stop?: () => void }

export type ModelDownloads = {
  // { pct } while the model downloads, else null.
  download(modelId: string): { pct: number } | null
  // How its last download here ended, if one did.
  outcome(modelId: string): DownloadOutcome | undefined
  start(modelId: string): Promise<void>
  cancel(modelId: string): Promise<void>
  subscribe(listener: (modelId: string) => void): () => void
  // Changes with every change, for useSyncExternalStore.
  version(): number
}

// readToken: the HuggingFace token of the settings, for gated models.
export function createModelDownloads(api: ApiClient, readToken: () => Promise<string | null>): ModelDownloads {
  const running = new Map<string, Entry>()
  const outcomes = new Map<string, DownloadOutcome>()
  const listeners = new Set<(modelId: string) => void>()
  let changes = 0

  const notify = (modelId: string) => {
    changes++
    listeners.forEach(listener => listener(modelId))
  }
  const finish = (modelId: string, entry: Entry, outcome: DownloadOutcome) => {
    if (running.get(modelId) !== entry) return
    entry.stop?.()
    running.delete(modelId)
    outcomes.set(modelId, outcome)
    notify(modelId)
  }

  return {
    download: modelId => {
      const entry = running.get(modelId)
      return entry ? { pct: entry.pct } : null
    },
    outcome: modelId => outcomes.get(modelId),
    start: async modelId => {
      if (running.has(modelId)) return
      const entry: Entry = { pct: 0, jobId: null }
      running.set(modelId, entry)
      outcomes.delete(modelId)
      notify(modelId)
      try {
        const jobId = await api.startModelDownload(modelId, await readToken())
        // Cancelled before the backend answered: stop the job it started.
        if (running.get(modelId) !== entry) {
          await api.cancelModelDownload(modelId, jobId).catch(() => {})
          return
        }
        entry.jobId = jobId
        entry.stop = api.watchModelDownload(jobId, event => {
          if (event.type === 'progress') {
            entry.pct = event.pct
            notify(modelId)
          } else {
            finish(modelId, entry, event.type === 'done' ? 'done' : event.type === 'cancelled' ? 'cancelled' : 'failed')
          }
        })
      } catch {
        finish(modelId, entry, 'failed')
      }
    },
    cancel: async modelId => {
      const entry = running.get(modelId)
      if (!entry) return
      if (entry.jobId) await api.cancelModelDownload(modelId, entry.jobId).catch(() => {})
      finish(modelId, entry, 'cancelled')
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    version: () => changes,
  }
}

const readHfToken = async () => {
  const bridge = typeof window === 'undefined' ? undefined : window.electronAPI
  const settings = await bridge?.readSettings().catch(() => undefined)
  return settings?.hfToken || null
}

// One store per client: the app has one, each story and test its own.
const stores = new WeakMap<ApiClient, ModelDownloads>()

function storeFor(api: ApiClient): ModelDownloads {
  let store = stores.get(api)
  if (!store) stores.set(api, store = createModelDownloads(api, readHfToken))
  return store
}

// The downloads, re-rendering the caller on every change. A model that finished
// downloading is installed now: the catalog is read again.
export function useModelDownloads(): ModelDownloads {
  const api = useApi()
  const queries = useQueryClient()
  const store = storeFor(api)
  useSyncExternalStore(store.subscribe, store.version)
  useEffect(() => store.subscribe(modelId => {
    if (!store.download(modelId) && store.outcome(modelId) === 'done') void queries.invalidateQueries({ queryKey: queryKeys.models })
  }), [store, queries])
  return store
}
