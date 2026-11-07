import type { ModelInfo } from '../api/types'
import { languageName } from './languages'

// The default Whisper model. Settings keep it (transcribeModel) with the models that
// were the default before it (transcribeModelHistory, oldest first). There is no
// built-in default: with no Whisper model installed there is none. The new UI works
// the default out from GET /models every time and does not save it.

export const MODEL_HISTORY_LIMIT = 5

export type SavedModel = { transcribeModel: string | null; transcribeModelHistory: readonly string[] }

// installed: the ids of the installed Whisper models in catalog order, least to most
// accurate. A default that is gone falls back to the latest one of the history that
// is still there, then to the most accurate installed model.
export function resolveTranscribeModel({ current, history = [], installed }: {
  current: string | null
  history?: readonly string[]
  installed: readonly string[]
}): string | null {
  if (current && installed.includes(current)) return current
  for (let i = history.length - 1; i >= 0; i--) {
    if (installed.includes(history[i])) return history[i]
  }
  return installed.at(-1) ?? null
}

// id becomes the latest entry, without repeats, at most MODEL_HISTORY_LIMIT.
export function pushModelHistory(history: readonly string[] = [], id: string): string[] {
  return [...history.filter(entry => entry !== id), id].slice(-MODEL_HISTORY_LIMIT)
}

export function installedWhisperModels(models: readonly ModelInfo[]): string[] {
  return models.filter(model => model.kind === 'whisper' && model.installed).map(model => model.id)
}

export function whisperModels(models: readonly ModelInfo[]) {
  return models.flatMap(model => (model.kind === 'whisper' ? [model] : []))
}

export type ModelState = {
  models: readonly ModelInfo[]
  // The default to use, installed; null when no Whisper model is.
  model: string | null
  diarizeInstalled: boolean
}

export function modelState(models: readonly ModelInfo[], saved: Partial<SavedModel> = {}): ModelState {
  return {
    models,
    model: resolveTranscribeModel({
      current: saved.transcribeModel ?? null,
      history: saved.transcribeModelHistory ?? [],
      installed: installedWhisperModels(models),
    }),
    diarizeInstalled: models.some(model => model.kind === 'diarization' && model.installed),
  }
}

// The alignment model a language needs when it is not installed; null for a language
// that needs none (en, es, de, fr, detected) or has it.
export function missingAlignmentModel(language: string | null, models: readonly ModelInfo[]): ModelInfo | null {
  const row = models.find(model => model.kind === 'alignment' && model.id === language)
  return row && !row.installed ? row : null
}

// The default as the old UI kept it: the saved model when it is installed, else none.
function savedIfInstalled(saved: Partial<SavedModel>, models: readonly ModelInfo[]): string | null {
  const id = saved.transcribeModel ?? null
  return id && installedWhisperModels(models).includes(id) ? id : null
}

// What the settings get when the default changes.
export type ModelChange = { transcribeModel: string | null; transcribeModelHistory: string[] }

// What to save when the default changes with a new catalog, or null when it does not.
// previous: the catalog before, null for the first answer, which is the baseline: an
// installed default stays silently, and a saved one that is gone is replaced.
export function defaultModelChange(
  previous: readonly ModelInfo[] | null,
  models: readonly ModelInfo[],
  saved: Partial<SavedModel>,
): ModelChange | null {
  const before = savedIfInstalled(saved, previous ?? models)
  const history = saved.transcribeModelHistory ?? []
  const next = resolveTranscribeModel({ current: saved.transcribeModel ?? null, history, installed: installedWhisperModels(models) })
  if (next === before) return null
  return { transcribeModel: next, transcribeModelHistory: next ? pushModelHistory(history, next) : [...history] }
}

// The user picked the default: it becomes the latest of the history.
export function selectedModel(saved: Partial<SavedModel>, id: string): ModelChange {
  return { transcribeModel: id, transcribeModelHistory: pushModelHistory(saved.transcribeModelHistory, id) }
}

export function defaultModelMessage(id: string | null, models: readonly ModelInfo[]): string {
  if (!id) return 'No transcription model installed — download one in Settings'
  return `${whisperModels(models).find(model => model.id === id)?.name ?? id} is now the default transcription model`
}

export type BlockReason =
  | { missing: 'whisper' }
  | { missing: 'diarization' }
  | { missing: 'alignment'; language: string }

// Why a job in this language cannot start, or null: the Whisper model, the
// diarization model, then the language's alignment model, as the backend checks.
export function jobBlockReason(state: ModelState, language: string): BlockReason | null {
  if (!state.model) return { missing: 'whisper' }
  if (!state.diarizeInstalled) return { missing: 'diarization' }
  if (missingAlignmentModel(language, state.models)) return { missing: 'alignment', language }
  return null
}

export function blockMessage(reason: BlockReason): string {
  switch (reason.missing) {
    case 'whisper': return 'No transcription model installed'
    case 'diarization': return 'Diarization model not installed'
    case 'alignment': return `Alignment model for ${languageName(reason.language)} is not installed`
  }
}
