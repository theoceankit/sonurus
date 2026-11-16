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
  // 'system' follows the OS.
  theme: ThemeSource
  // Closing the window keeps the app running in the tray (electron/tray.js).
  closeToTray: boolean
}

export type ThemeSource = 'system' | 'light' | 'dark'

export type ElectronAPI = {
  getPlatform: () => Promise<string>
  getAppVersion: () => Promise<string>
  // Whether the system shows a tray to keep the app in when its window closes.
  getTrayAvailable: () => Promise<boolean>
  openFiles: () => Promise<string[]>
  getFilePath: (file: File) => string
  readSettings: () => Promise<ElectronSettings>
  writeSettings: (data: ElectronSettings) => Promise<void>
  setZoom: (factor: number) => Promise<void>
  // Sets the theme of the window: its frame, and prefers-color-scheme in the page.
  setTheme: (source: ThemeSource) => Promise<void>
  writeClipboard: (text: string) => Promise<void>
  restartBackend: () => Promise<void>
  // '' once the file manager opened the models folder, else why it did not.
  showModelsFolder: () => Promise<string>
  setWindowDimmed: (dimmed: boolean, startedAt: number) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
