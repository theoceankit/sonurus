// What electron/preload.js exposes. A build test keeps the keys the same.
export type ExportFormat = 'txt' | 'md' | 'json'

export type ExportRequest = {
  title: string
  // The format the save dialog starts on.
  format: ExportFormat
  contents: Record<ExportFormat, string>
}

export type ExportResult = { status: 'saved' | 'canceled' } | { status: 'failed'; message: string }

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
  // Every notification of the main process, the tray notice included.
  notifications: boolean
  // Notifications of transcriptions that finished or failed, while the window is not in front.
  notifyTranscriptions: boolean
  // A notification when another app has held a microphone for a while: a call may
  // have started (electron/recording-prompts.js).
  promptStart: boolean
  // For any app, or only for the apps in promptStartSelected (their ids).
  promptStartApps: 'any' | 'selected'
  promptStartSelected: string[]
  // When a call seems to have ended during a recording: a notification, a stop, or nothing.
  promptEnd: 'suggest' | 'auto' | 'off'
}

// What a click on a notification asks the window to open.
export type WindowIntent =
  | { dialog: 'new-recording'; app: string | null }
  | { dialog: 'stop-recording' }
  // A transcription finished, or failed (electron/job-notices.js).
  | { open: 'recording'; transcriptId: number }
  | { open: 'job'; jobId: string }
  | { open: 'alignment-model'; language: string }

// An app that held a microphone long enough to suggest a recording.
export type MicApp = { id: string; name: string }

export type ThemeSource = 'system' | 'light' | 'dark'

// The last notification the system did not show, and its error (electron/notifications.js).
export type NotificationRefusal = { title: string; error: string }

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
  // The save dialog, then the text of the format the picked file's extension names.
  saveExport: (request: ExportRequest) => Promise<ExportResult>
  restartBackend: () => Promise<void>
  // '' once the file manager opened the models folder, else why it did not.
  showModelsFolder: () => Promise<string>
  // A link of a note, in the user's browser or mail app: true once handed over,
  // false for an address that is not http, https or mailto.
  openLink: (address: string) => Promise<boolean>
  // Called before the window closes or the app quits, and waited for: saves what
  // still waits. Returns what stops listening.
  onWindowClosing: (callback: () => Promise<void>) => () => void
  setWindowDimmed: (dimmed: boolean, startedAt: number) => void
  // The dialog a notification asked for, once; null when none waits.
  takeWindowIntent: () => Promise<WindowIntent | null>
  // Called when an intent waits for the open window; returns what stops listening.
  onWindowIntent: (callback: () => void) => () => void
  getMicApps: () => Promise<MicApp[]>
  // Null once a notification shows again.
  getNotificationRefusal: () => Promise<NotificationRefusal | null>
  // Called when that changes; returns what stops listening.
  onNotificationRefusal: (callback: () => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
