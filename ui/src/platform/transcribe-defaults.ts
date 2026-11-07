import type { ElectronSettings } from './electron-api'

export type TranscribeDefaults = { whisperModel: string | null; language: string | null }

// The model and language the old UI's Settings save as defaults. No model is the
// backend's own default; "auto" is a language detected from the audio, null to the API.
export function transcribeDefaults(settings: Partial<ElectronSettings> | undefined): TranscribeDefaults {
  const language = settings?.transcribeLang
  return {
    whisperModel: settings?.transcribeModel || null,
    language: !language || language === 'auto' ? null : language,
  }
}

// Without Electron (Storybook, tests) the backend decides both.
export async function readTranscribeDefaults(): Promise<TranscribeDefaults> {
  const bridge = typeof window === 'undefined' ? undefined : window.electronAPI
  return transcribeDefaults(await bridge?.readSettings().catch(() => undefined))
}
