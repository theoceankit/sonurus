// What electron/preload.js exposes. A build test keeps the keys the same.
export type ElectronSettings = {
  scale: number
  transcribeLang: string
  transcribeModel: string | null
  transcribeModelHistory: string[]
  exportFormat: string
  recordingMicDevice: string | null
  recordingSystemDevice: string | null
  recordingUseMic: boolean
  hfToken: string
  // The new UI's recordings opened last, newest first. The old UI leaves it alone.
  recentTranscriptIds: number[]
}

export type ElectronAPI = {
  getPlatform: () => Promise<string>
  getAppVersion: () => Promise<string>
  openFiles: () => Promise<string[]>
  getFilePath: (file: File) => string
  readSettings: () => Promise<ElectronSettings>
  writeSettings: (data: ElectronSettings) => Promise<void>
  setZoom: (factor: number) => Promise<void>
  writeClipboard: (text: string) => Promise<void>
  restartBackend: () => Promise<void>
  setWindowDimmed: (dimmed: boolean, startedAt: number) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
