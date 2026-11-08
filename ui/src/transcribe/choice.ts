import type { SelectOption } from '../components/Select/Select'
import type { TranscribeSettings } from '../platform/transcribe-defaults'
import { languageName, LANGUAGES } from './languages'
import type { ModelInfo } from '../api/types'
import { installedWhisperModels, jobBlockReason, missingAlignmentModel, modelState, whisperModels, type BlockReason } from './models'

// The model and language of one run, as a dialog offers them. They start from the
// defaults of the settings; what the user picks there is for this run and is not saved.
export type Picked = { model: string | null; language: string | null }

export const NOTHING_PICKED: Picked = { model: null, language: null }

export const NOT_INSTALLED = 'Not installed'

export type TranscribeChoice = {
  // True until GET /models has answered once and the settings are read.
  checking: boolean
  model: string | null
  // Empty while the default is not known yet.
  language: string
  // Why the run cannot start; null when it can, and while checking.
  blocked: BlockReason | null
  modelOptions: SelectOption[]
  languageOptions: SelectOption[]
}

// models: the last catalog, undefined before any; settings: null until read. A model
// picked here stays while it is installed; when it goes, the default takes its place.
export function transcribeChoice(models: readonly ModelInfo[] | undefined, settings: TranscribeSettings | null, picked: Picked): TranscribeChoice {
  const language = picked.language ?? settings?.transcribeLang ?? ''
  const languageOptions = LANGUAGES.map(({ code, label }) => {
    const off = !!models && !!missingAlignmentModel(code, models)
    return { value: code, label, ...(off ? { disabled: true, meta: NOT_INSTALLED } : {}) }
  })
  // A saved language that is not in the list is still shown, as the old UI did.
  if (language && !LANGUAGES.some(({ code }) => code === language)) languageOptions.push({ value: language, label: languageName(language) })
  if (!models || !settings) return { checking: true, model: null, language, blocked: null, modelOptions: [], languageOptions }

  const state = modelState(models, settings)
  const model = picked.model && installedWhisperModels(models).includes(picked.model) ? picked.model : state.model
  const modelOptions = whisperModels(models).map(({ id, name, installed }) => ({
    value: id, label: name, ...(installed ? {} : { disabled: true, meta: NOT_INSTALLED }),
  }))
  return { checking: false, model, language, blocked: jobBlockReason({ ...state, model }, language), modelOptions, languageOptions }
}
