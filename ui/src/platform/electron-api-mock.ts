import type { ElectronAPI, ElectronSettings } from './electron-api'

// Stands in for the preload bridge where there is no Electron: Storybook and
// tests. Settings and the clipboard stay in memory.
export type MockElectronAPI = ElectronAPI & { clipboard: () => string }

export function createMockElectronAPI(changes: Partial<ElectronAPI> = {}): MockElectronAPI {
  let settings: ElectronSettings = {
    scale: 100,
    transcribeLang: 'auto',
    transcribeModel: null,
    transcribeModelHistory: [],
    exportFormat: 'txt',
    recordingMicDevice: null,
    recordingSystemDevice: null,
    recordingUseMic: true,
    hfToken: '',
    recentTranscriptIds: [],
  }
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
    setWindowDimmed: () => {},
    clipboard: () => clipboard,
    ...changes,
  }
}
