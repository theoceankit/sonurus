// What electron/preload.js exposes. A build test keeps the keys the same.
export type ElectronSettings = {
  scale: number
  transcribeLang: string
  transcribeModel: string | null
  transcribeModelHistory: string[]
  exportFormat: string
  // What a live recording takes, as the New recording dialog last started it.
  recordingAudioSource: 'mic' | 'system' | 'both'
  // Null is the default microphone, or the default system audio source.
  recordingMicDevice: string | null
  recordingSystemDevice: string | null
  hfToken: string
  // The recordings opened last, newest first.
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
