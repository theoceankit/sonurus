import { ApiError } from '../api/client'
import type { RefusalCode } from '../api/types'

// A refusal of the queue's job routes, as a window shows it.
export interface Refusal {
  message: string
  code: RefusalCode | null
  // A model the job needs is not downloaded: the way out is this section of Settings.
  settingsSection: 'models' | 'alignment' | null
}

const SETTINGS_SECTIONS: Partial<Record<RefusalCode, Refusal['settingsSection']>> = {
  whisper_model_missing: 'models',
  diarization_model_missing: 'models',
  alignment_model_missing: 'alignment',
}

// What to show of a failed request. The code decides the way out, never the wording.
export function refusalOf(error: unknown): Refusal {
  if (!(error instanceof ApiError)) return { message: error instanceof Error ? error.message : String(error), code: null, settingsSection: null }
  if (error.status === 0) return { message: 'The backend is not responding.', code: null, settingsSection: null }
  return { message: error.message, code: error.code, settingsSection: (error.code && SETTINGS_SECTIONS[error.code]) ?? null }
}
