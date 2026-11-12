import type { ElectronAPI, ElectronSettings } from './electron-api'
import { DEFAULT_SETTINGS } from './settings'

// Stands in for the preload bridge where there is no Electron: Storybook and
// tests. Settings and the clipboard stay in memory.
export type MockElectronAPI = ElectronAPI & { clipboard: () => string }

export function createMockElectronAPI(changes: Partial<ElectronAPI> = {}): MockElectronAPI {
  let settings: ElectronSettings = structuredClone(DEFAULT_SETTINGS)
  let clipboard = ''
  return {
    getPlatform: async () => 'linux',
    getAppVersion: async () => '0.0.0-storybook',
    openFiles: async () => [],
    getFilePath: file => `/fixtures/${file.name}`,
    readSettings: async () => structuredClone(settings),
    writeSettings: async data => { settings = structuredClone(data) },
    setZoom: async () => {},
    writeClipboard: async text => { clipboard = text },
    restartBackend: async () => {},
    showModelsFolder: async () => '',
    setWindowDimmed: () => {},
    clipboard: () => clipboard,
    ...changes,
  }
}
