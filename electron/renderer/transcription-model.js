// ── Default transcription model ──────────────────────────────────────────────
// Settings keeps the default Whisper model (`transcribeModel`) and the models
// that were the default before it (`transcribeModelHistory`, oldest first).
// There is no built-in default: with no Whisper model installed it is null.
//
// syncTranscribeModel() re-resolves the default every time GET /models is
// fetched (app start, Settings, the New Recording modal, window drops, a
// finished download, a deleted model), so "first model downloaded" and "the
// default was deleted" are the same step. A saved model that is not installed
// counts as no model. New jobs need a default model and the diarization model:
// without them nothing is queued (noModelMessage()).

const MODEL_HISTORY_LIMIT = 5

// Last GET /models answer; null until the backend has answered once.
let _modelCatalog = null

// Pure. `installed`: ids of the installed Whisper models in catalog order
// (tiny → large-v3, i.e. least to most accurate).
function resolveTranscribeModel({ current, history = [], installed }) {
  if (current && installed.includes(current)) return current
  for (let i = history.length - 1; i >= 0; i--) {
    if (installed.includes(history[i])) return history[i]
  }
  return installed.length ? installed[installed.length - 1] : null
}

// Pure: `id` becomes the latest entry, without repeats, at most MODEL_HISTORY_LIMIT.
function pushModelHistory(history = [], id) {
  return [...history.filter(h => h !== id), id].slice(-MODEL_HISTORY_LIMIT)
}

function installedWhisperModels(models) {
  return models.filter(m => m.kind === 'whisper' && m.installed).map(m => m.id)
}

// { models, model, diarizeInstalled } from a GET /models answer (default: the
// last one), or null when the backend has not answered yet. `model` is the
// saved default only if it is installed.
function modelState(models = _modelCatalog) {
  if (!models) return null
  const saved = appSettings.transcribeModel ?? null
  return {
    models,
    model: installedWhisperModels(models).includes(saved) ? saved : null,
    diarizeInstalled: models.some(m => m.kind === 'diarization' && m.installed),
  }
}

function modelName(models, id) {
  return models.find(m => m.id === id)?.name || id
}

function defaultModelToast(id, models) {
  return id
    ? `${modelName(models, id)} is now the default transcription model`
    : 'No transcription model installed — download one in Settings'
}

// Why new jobs cannot start (window drops, modal drops), or null.
function noModelMessage(state) {
  if (!state.model) return 'No transcription model installed — download one in Settings'
  if (!state.diarizeInstalled) return 'Diarization model not installed — download it in Settings'
  return null
}

// The alignment model a language needs (catalog row) when it is not installed;
// null for a language with none in the catalog (en, es, de, fr, Detect).
function missingAlignmentModel(lang, models) {
  const row = models.find(m => m.kind === 'alignment' && m.id === lang)
  return row && !row.installed ? row : null
}

// A model by id: its GET /models row with the name and size of the static
// catalog (data.js) — alignment rows from the backend carry neither.
function catalogModel(id) {
  const known = [...MODELS, ...ALIGNMENT_MODELS].find(m => m.id === id) || { id, name: id, kind: 'unknown' }
  return { ...known, ...modelState()?.models.find(m => m.id === id) }
}

function languageLabel(lang) {
  return LANGUAGES.find(l => l.code === lang)?.label || lang
}

// Why a job in `language` cannot start, or null: Whisper model, diarization
// model, then the language's alignment model.
function jobBlockMessage(state, language) {
  const missing = noModelMessage(state)
  if (missing) return missing
  if (missingAlignmentModel(language, state.models)) {
    return `Alignment model for ${languageLabel(language)} is not installed — download it in Settings`
  }
  return null
}

// The same for the hint above Settings → ML Models.
function settingsModelHint(state) {
  if (!state.model) return 'No model selected — download a Whisper model to transcribe'
  if (!state.diarizeInstalled) return 'Diarization model not installed — download it to transcribe'
  return null
}

// Fetches GET /models and re-resolves the default. When the effective default
// changes (installed before vs. now), it is saved with its history and a toast
// says so. Returns modelState() — the last known one if the backend is down.
async function syncTranscribeModel() {
  let models
  try {
    const r = await fetch(`${API_BASE}/models`)
    if (!r.ok) throw new Error(`Server error ${r.status}`)
    models = await r.json()
  } catch {
    return modelState()
  }
  // Without an earlier answer (app start) the baseline is the current one, so
  // a saved model that is not installed changes nothing and says nothing.
  const before = modelState(_modelCatalog ?? models).model
  _modelCatalog = models

  const next = resolveTranscribeModel({
    current: appSettings.transcribeModel ?? null,
    history: appSettings.transcribeModelHistory || [],
    installed: installedWhisperModels(models),
  })
  if (next !== before) {
    const patch = { transcribeModel: next }
    if (next) patch.transcribeModelHistory = pushModelHistory(appSettings.transcribeModelHistory, next)
    await saveSettings(patch)
    window.showToast?.(defaultModelToast(next, models))
  }
  return modelState()
}

// The user picks the default (Settings → Use). No toast: they just did it.
function selectTranscribeModel(id) {
  return saveSettings({
    transcribeModel: id,
    transcribeModelHistory: pushModelHistory(appSettings.transcribeModelHistory, id),
  })
}

// Model and language for files dropped on the window: the defaults as they
// are. Null (with a toast) when the models a job needs are missing.
async function dropImportOptions() {
  const state = await syncTranscribeModel()
  if (!state) {
    window.showToast?.('Could not reach the transcription service', 'error')
    return null
  }
  const language = appSettings.transcribeLang || 'auto'
  const message = jobBlockMessage(state, language)
  if (message) {
    window.showToast?.(message, { actionLabel: 'Open Settings', action: () => app.showSettings() })
    return null
  }
  return { model: state.model, language }
}

// Option of a Whisper model dropdown (New Recording modal, queue job modal):
// the name, plus "Not installed" in the list for a disabled (not downloaded)
// model. Pass as makeDropdown's renderOption.
function renderModelOption(opt, isTrigger) {
  const name = document.createElement('span')
  name.textContent = opt.label
  if (!opt.disabled || isTrigger) return name
  const note = document.createElement('span')
  note.className = 'st-dropdown-item-note'
  note.textContent = 'Not installed'
  const row = document.createElement('span')
  row.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%'
  row.append(name, note)
  return row
}

// ── Deleting a model the queue needs ─────────────────────────────────────────
// `model` is a GET /models row; `snapshot` the last WS /ws/queue snapshot.
// Every job needs the diarization model; a Whisper model only its own jobs; an
// alignment model the jobs in its language (not auto-detect: unknown yet).

function _jobNeedsModel(job, model) {
  if (model.kind === 'diarization') return true
  if (model.kind === 'whisper') return job.whisper_model === model.id
  return model.kind === 'alignment' && job.language === model.id
}

// How many waiting or failed jobs need `model`.
function queuedJobsUsingModel(model, snapshot) {
  if (!snapshot) return 0
  return snapshot.jobs.filter(j => (j.status === 'waiting' || j.status === 'failed') && _jobNeedsModel(j, model)).length
}

// The running transcription needs `model` (the backend refuses the delete).
function modelInUseByRunningJob(model, snapshot) {
  const running = snapshot?.jobs.find(j => j.id === snapshot.running_job_id)
  return !!running && _jobNeedsModel(running, model)
}

// Confirmation before deleting a model `count` queued jobs need, or null.
function modelDeletePrompt(model, count) {
  if (!count) return null
  const jobs = count === 1 ? '1 job in the queue uses' : `${count} jobs in the queue use`
  return { title: `Delete ${model.name}?`, body: `${jobs} ${model.name}. Delete anyway?` }
}
