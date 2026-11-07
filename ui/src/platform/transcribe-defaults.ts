import type { SavedModel } from '../transcribe/models'
import type { ElectronSettings } from './electron-api'

// What the settings keep for new transcriptions: the default model with its history
// and the default language, "auto" for one detected from the audio.
export type TranscribeSettings = SavedModel & { transcribeLang: string }

export function transcribeSettings(settings: Partial<ElectronSettings> | undefined): TranscribeSettings {
  return {
    transcribeModel: settings?.transcribeModel || null,
    transcribeModelHistory: settings?.transcribeModelHistory ?? [],
    transcribeLang: settings?.transcribeLang || 'auto',
  }
}

// Without Electron (Storybook, tests) nothing is saved: no model, detected language.
export async function readTranscribeSettings(): Promise<TranscribeSettings> {
  const bridge = typeof window === 'undefined' ? undefined : window.electronAPI
  return transcribeSettings(await bridge?.readSettings().catch(() => undefined))
}
