import { useEffect, useSyncExternalStore } from 'react'
import type { ElectronAPI, ElectronSettings } from './electron-api'

// Electron's settings file (settings.json in userData). writeSettings writes it whole,
// so every change here goes through one queue: each write reads the file again and
// puts the change on top, and a change made elsewhere in the meantime stays.

// The same values as DEFAULT_SETTINGS in electron/main.js; a build test keeps them so.
export const DEFAULT_SETTINGS: ElectronSettings = {
  scale: 100,
  transcribeLang: 'auto',
  transcribeModel: null,
  transcribeModelHistory: [],
  exportFormat: 'txt',
  recordingAudioSource: 'both',
  recordingMicDevice: null,
  recordingSystemDevice: null,
  hfToken: '',
  recentTranscriptIds: [],
}

export type SettingsStore = {
  // What the app knows of the settings: null until the file has been read once.
  current(): ElectronSettings | null
  // The settings, read from the file the first time.
  read(): Promise<ElectronSettings>
  // Shown at once, written after the writes before it.
  patch(change: Partial<ElectronSettings>): Promise<void>
  subscribe(listener: () => void): () => void
}

// Without a bridge (Storybook without one, tests) nothing is written: the settings
// start from the defaults and are kept in memory.
export function createSettingsStore(bridge: ElectronAPI | undefined): SettingsStore {
  let settings: ElectronSettings | null = bridge ? null : structuredClone(DEFAULT_SETTINGS)
  // What was patched before the file was read, to put on top of it.
  let early: Partial<ElectronSettings> = {}
  let reading: Promise<ElectronSettings> | null = null
  let writes: Promise<void> = Promise.resolve()
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach(listener => listener())

  const read = () => {
    if (settings) return Promise.resolve(settings)
    reading ??= (bridge?.readSettings() ?? Promise.resolve(DEFAULT_SETTINGS))
      .catch(() => DEFAULT_SETTINGS)
      .then(file => {
        settings ??= { ...DEFAULT_SETTINGS, ...file, ...early }
        notify()
        return settings
      })
    return reading
  }

  return {
    current: () => settings,
    read,
    patch: change => {
      if (settings) settings = { ...settings, ...change }
      else early = { ...early, ...change }
      notify()
      if (!bridge) return Promise.resolve()
      writes = writes
        .then(() => bridge.readSettings())
        .then(file => bridge.writeSettings({ ...DEFAULT_SETTINGS, ...file, ...change }))
        .catch(() => {})
      return writes
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

const bridge = (): ElectronAPI | undefined => (typeof window === 'undefined' ? undefined : window.electronAPI)

// One store per bridge: the app has one, each story and test that stubs one its own.
const stores = new WeakMap<ElectronAPI, SettingsStore>()
let memory = createSettingsStore(undefined)

export function settingsStore(): SettingsStore {
  const api = bridge()
  if (!api) return memory
  let store = stores.get(api)
  if (!store) stores.set(api, store = createSettingsStore(api))
  return store
}

// Tests without a bridge each start from the defaults.
export function resetMemorySettings() {
  memory = createSettingsStore(undefined)
}

// The settings, re-rendering on every change; null until they have been read.
export function useSettings(): ElectronSettings | null {
  const store = settingsStore()
  const settings = useSyncExternalStore(store.subscribe, store.current)
  useEffect(() => { void store.read() }, [store])
  return settings
}

// The saved interface scale applies from the start.
export async function applySavedScale() {
  const settings = await settingsStore().read()
  await bridge()?.setZoom(settings.scale / 100).catch(() => {})
}
