// GET /models answers for renderer tests, and a way to give a loaded renderer
// context a known model catalog (transcription-model.js keeps the last answer
// in a top-level `let`, which only code run inside the context can reach).
const vm = require('node:vm')

const CATALOG = [
  { id: 'tiny',     name: 'Whisper Tiny',     kind: 'whisper',     size: '39 MB' },
  { id: 'base',     name: 'Whisper Base',     kind: 'whisper',     size: '74 MB' },
  { id: 'small',    name: 'Whisper Small',    kind: 'whisper',     size: '244 MB' },
  { id: 'medium',   name: 'Whisper Medium',   kind: 'whisper',     size: '769 MB' },
  { id: 'large-v3', name: 'Whisper Large v3', kind: 'whisper',     size: '1.55 GB' },
  { id: 'diarize',  name: 'Diarization · v2', kind: 'diarization', size: '130 MB' },
  { id: 'ru',       name: 'Russian',          kind: 'alignment',   size: '1.26 GB' },
  { id: 'uk',       name: 'Ukrainian',        kind: 'alignment',   size: '1.26 GB' },
  { id: 'zh',       name: 'Chinese',          kind: 'alignment',   size: '1.26 GB' },
  { id: 'ja',       name: 'Japanese',         kind: 'alignment',   size: '1.26 GB' },
]

const ALL = CATALOG.map(m => m.id)

// The catalog with `installed` set for the given ids.
function models(installed = ALL) {
  return CATALOG.map(m => ({ ...m, installed: installed.includes(m.id) }))
}

function seedModels(ctx, list) {
  vm.runInContext(`_modelCatalog = ${JSON.stringify(list)}`, ctx)
}

// fetch stand-in: GET /models answers `current()` (a function, so tests can
// change what is installed between calls); anything else never settles.
function modelsFetch(current) {
  return url => String(url).endsWith('/models')
    ? Promise.resolve({ ok: true, json: async () => current() })
    : new Promise(() => {})
}

module.exports = { models, seedModels, modelsFetch, ALL }
