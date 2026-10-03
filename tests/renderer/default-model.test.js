// Default transcription model (transcription-model.js): no built-in default,
// re-resolved from GET /models (history first, then the most accurate
// installed model), and nothing starts without it or without diarization —
// in Settings, the New Recording modal and window drops.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadRenderer } = require('./load-renderer')
const { fakeElement } = require('./fake-dom')
const { models, seedModels, modelsFetch } = require('./models-fixture')

const ROOT = path.join(__dirname, '..', '..')
const plain = v => JSON.parse(JSON.stringify(v))
const pending = () => new Promise(() => {})
const flush = () => new Promise(resolve => setImmediate(resolve))

// ── Pure helpers ───────────────────────────────────────────────────────────────

const pure = loadRenderer(['transcription-model.js'])

test('resolveTranscribeModel: nothing installed → null', () => {
  assert.equal(pure.resolveTranscribeModel({ current: null, history: [], installed: [] }), null)
  assert.equal(pure.resolveTranscribeModel({ current: 'small', history: ['small'], installed: [] }), null)
})

test('resolveTranscribeModel: an installed default stays', () => {
  assert.equal(pure.resolveTranscribeModel({ current: 'base', history: ['tiny', 'base'], installed: ['tiny', 'base', 'large-v3'] }), 'base')
})

test('resolveTranscribeModel: a deleted default → the latest installed one from the history', () => {
  assert.equal(pure.resolveTranscribeModel({ current: 'base', history: ['tiny', 'base'], installed: ['tiny', 'large-v3'] }), 'tiny')
})

test('resolveTranscribeModel: A → B → C, B and C deleted → A', () => {
  assert.equal(pure.resolveTranscribeModel({ current: 'medium', history: ['tiny', 'small', 'medium'], installed: ['tiny', 'large-v3'] }), 'tiny')
})

test('resolveTranscribeModel: nothing from the history installed → the most accurate installed model', () => {
  assert.equal(pure.resolveTranscribeModel({ current: null, history: [], installed: ['tiny', 'medium'] }), 'medium')
  assert.equal(pure.resolveTranscribeModel({ current: 'small', history: ['small'], installed: ['base', 'large-v3'] }), 'large-v3')
})

test('pushModelHistory: latest last, no repeats, at most 5', () => {
  assert.deepEqual(plain(pure.pushModelHistory(undefined, 'tiny')), ['tiny'])
  assert.deepEqual(plain(pure.pushModelHistory(['tiny', 'base', 'small'], 'tiny')), ['base', 'small', 'tiny'])
  assert.deepEqual(plain(pure.pushModelHistory(['a', 'b', 'c', 'd', 'e'], 'f')), ['b', 'c', 'd', 'e', 'f'])
})

test('noModelMessage / settingsModelHint: Whisper first, then diarization, else null', () => {
  assert.equal(pure.noModelMessage({ model: null, diarizeInstalled: false }), 'No transcription model installed — download one in Settings')
  assert.equal(pure.noModelMessage({ model: 'tiny', diarizeInstalled: false }), 'Diarization model not installed — download it in Settings')
  assert.equal(pure.noModelMessage({ model: 'tiny', diarizeInstalled: true }), null)
  assert.equal(pure.settingsModelHint({ model: null, diarizeInstalled: true }), 'No model selected — download a Whisper model to transcribe')
  assert.equal(pure.settingsModelHint({ model: 'tiny', diarizeInstalled: false }), 'Diarization model not installed — download it to transcribe')
  assert.equal(pure.settingsModelHint({ model: 'tiny', diarizeInstalled: true }), null)
})

// ── syncTranscribeModel ────────────────────────────────────────────────────────

// A renderer context whose GET /models answers `installed` (changeable).
function backend(settings = {}, installed = []) {
  const state = { installed, toasts: [], saved: [], shownSettings: 0 }
  const appSettings = { transcribeModel: null, transcribeModelHistory: [], transcribeLang: 'auto', ...settings }
  state.appSettings = appSettings
  state.ctx = loadRenderer(['transcription-model.js'], {
    API_BASE: 'http://api',
    appSettings,
    app: { showSettings: () => { state.shownSettings++ } },
    window: { showToast: (text, opts) => state.toasts.push({ text, opts }) },
    fetch: modelsFetch(() => models(state.installed)),
    saveSettings: async patch => { state.saved.push(plain(patch)); Object.assign(appSettings, patch) },
  })
  return state
}

const texts = toasts => toasts.map(t => t.text)

test('sync: nothing installed → no default, no toast, nothing saved', async () => {
  const b = backend()
  const state = await b.ctx.syncTranscribeModel()
  assert.equal(state.model, null)
  assert.equal(state.diarizeInstalled, false)
  assert.deepEqual(b.saved, [])
  assert.deepEqual(b.toasts, [])
})

test('sync: a saved model that is not installed counts as none — no toast, nothing saved', async () => {
  const b = backend({ transcribeModel: 'small' })
  const state = await b.ctx.syncTranscribeModel()
  assert.equal(state.model, null)
  assert.deepEqual(b.saved, [])
  assert.deepEqual(b.toasts, [])
})

test('sync: an installed default at start → kept silently', async () => {
  const b = backend({ transcribeModel: 'base', transcribeModelHistory: ['base'] }, ['base', 'diarize'])
  const state = await b.ctx.syncTranscribeModel()
  assert.equal(state.model, 'base')
  assert.equal(state.diarizeInstalled, true)
  assert.deepEqual(b.saved, [])
  assert.deepEqual(b.toasts, [])
})

test('sync: the first downloaded model becomes the default, with a toast', async () => {
  const b = backend()
  await b.ctx.syncTranscribeModel()
  b.installed = ['tiny']
  const state = await b.ctx.syncTranscribeModel()
  assert.equal(state.model, 'tiny')
  assert.deepEqual(b.saved, [{ transcribeModel: 'tiny', transcribeModelHistory: ['tiny'] }])
  assert.deepEqual(texts(b.toasts), ['Whisper Tiny is now the default transcription model'])
})

test('sync: the default deleted → the previous one from the history, with a toast', async () => {
  const b = backend({ transcribeModel: 'base', transcribeModelHistory: ['tiny', 'base'] }, ['tiny', 'base'])
  await b.ctx.syncTranscribeModel()
  b.installed = ['tiny']
  const state = await b.ctx.syncTranscribeModel()
  assert.equal(state.model, 'tiny')
  assert.equal(b.appSettings.transcribeModel, 'tiny')
  assert.deepEqual(plain(b.appSettings.transcribeModelHistory), ['base', 'tiny'])
  assert.deepEqual(texts(b.toasts), ['Whisper Tiny is now the default transcription model'])
})

test('sync: the default deleted, nothing from the history left → the most accurate installed one', async () => {
  const b = backend({ transcribeModel: 'small', transcribeModelHistory: ['small'] }, ['small', 'large-v3'])
  await b.ctx.syncTranscribeModel()
  b.installed = ['large-v3']
  assert.equal((await b.ctx.syncTranscribeModel()).model, 'large-v3')
  assert.deepEqual(texts(b.toasts), ['Whisper Large v3 is now the default transcription model'])
})

test('sync: the last model deleted → no default, with a toast', async () => {
  const b = backend({ transcribeModel: 'tiny', transcribeModelHistory: ['tiny'] }, ['tiny'])
  await b.ctx.syncTranscribeModel()
  b.installed = []
  const state = await b.ctx.syncTranscribeModel()
  assert.equal(state.model, null)
  assert.equal(b.appSettings.transcribeModel, null)
  assert.deepEqual(plain(b.appSettings.transcribeModelHistory), ['tiny'])
  assert.deepEqual(texts(b.toasts), ['No transcription model installed — download one in Settings'])
})

test('sync: the backend down → the last known state (null before any answer)', async () => {
  const b = backend({ transcribeModel: 'tiny' }, ['tiny', 'diarize'])
  b.ctx.fetch = () => Promise.reject(new Error('offline'))
  assert.equal(await b.ctx.syncTranscribeModel(), null)
  b.ctx.fetch = modelsFetch(() => models(b.installed))
  await b.ctx.syncTranscribeModel()
  b.ctx.fetch = () => Promise.reject(new Error('offline'))
  assert.equal((await b.ctx.syncTranscribeModel()).model, 'tiny')
})

test('selectTranscribeModel: saves the default and its history, no toast', async () => {
  const b = backend({ transcribeModel: 'tiny', transcribeModelHistory: ['tiny'] })
  await b.ctx.selectTranscribeModel('base')
  assert.deepEqual(b.saved, [{ transcribeModel: 'base', transcribeModelHistory: ['tiny', 'base'] }])
  assert.deepEqual(b.toasts, [])
})

// ── Window drops ───────────────────────────────────────────────────────────────

test('Window drop: no Whisper model → nothing to import, a toast that opens Settings', async () => {
  const b = backend({}, ['diarize'])
  assert.equal(await b.ctx.dropImportOptions(), null)
  assert.deepEqual(texts(b.toasts), ['No transcription model installed — download one in Settings'])
  assert.equal(b.toasts[0].opts.actionLabel, 'Open Settings')
  b.toasts[0].opts.action()
  assert.equal(b.shownSettings, 1)
})

test('Window drop: no diarization model → nothing to import, a toast', async () => {
  const b = backend({ transcribeModel: 'tiny' }, ['tiny'])
  assert.equal(await b.ctx.dropImportOptions(), null)
  assert.deepEqual(texts(b.toasts), ['Diarization model not installed — download it in Settings'])
})

test('Window drop: the default model and language are used', async () => {
  const b = backend({ transcribeModel: 'base', transcribeLang: 'de' }, ['base', 'diarize'])
  assert.deepEqual(plain(await b.ctx.dropImportOptions()), { model: 'base', language: 'de' })
  assert.deepEqual(b.toasts, [])
})

// ── New Recording modal ────────────────────────────────────────────────────────

function openModal({ settings = {}, catalog, fresh = null } = {}) {
  const created = []
  const dropdowns = []
  const toasts = []
  const calls = { start: [], import: [] }
  const appSettings = { transcribeModel: 'base', transcribeLang: 'auto', ...settings }
  let shownSettings = 0
  const ctx = loadRenderer(['utils.js', 'data.js', 'transcription-model.js', 'views/new-recording-modal.js'], {
    API_BASE: 'http://api',
    appSettings,
    app: { showSettings: () => { shownSettings++ } },
    document: { createElement: () => fakeElement(created), addEventListener() {}, removeEventListener() {} },
    window: {
      electronAPI: { getPlatform: pending, openFiles: async () => ['/a/call.wav'], getFilePath: f => f.path },
      showToast: (text, opts) => toasts.push({ text, opts }),
    },
    navigator: {},
    fetch: fresh ? modelsFetch(() => fresh) : pending,
    setTimeout,
    icon: () => '',
    markNotImplemented() {},
    saveSettings: async patch => Object.assign(appSettings, patch),
    makeDropdown: (options, value, onChange) => {
      dropdowns.push({ options: plain(options), value, onChange })
      return fakeElement(created)
    },
  })
  if (catalog) seedModels(ctx, catalog)
  ctx.renderNewRecordingModal({ onStart: s => calls.start.push(plain(s)), onImport: a => calls.import.push(plain(a)) })
  const el = cls => created.find(e => e.className === cls)
  return {
    ctx, calls, toasts, el, dropdowns,
    modelDropdown: () => [...dropdowns].reverse().find(d => d.options.some(o => o.value === 'large-v3')),
    shownSettings: () => shownSettings,
  }
}

test('Modal: before GET /models ever answered → "Checking models…", Start and Import off', () => {
  const m = openModal()
  assert.equal(m.el('nr-model-empty').textContent, 'Checking models…')
  assert.equal(m.el('nr-start-btn').disabled, true)
  assert.equal(m.el('nr-import-btn').disabled, true)
})

test('Modal: no Whisper model → "No model installed", a notice with a Settings link, Start and Import off', () => {
  const m = openModal({ catalog: models(['diarize']) })
  assert.equal(m.el('nr-model-empty').textContent, 'No model installed')
  assert.equal(m.el('nr-model-notice').style.display, '')
  assert.equal(m.el('nr-start-btn').disabled, true)
  assert.equal(m.el('nr-import-btn').disabled, true)
  m.el('nr-start-btn').fire('click')
  assert.deepEqual(m.calls.start, [])

  m.el('nr-model-notice-link').fire('click')
  assert.equal(m.shownSettings(), 1)
})

test('Modal: no diarization model → the dropdown, a notice, Start and Import off', () => {
  const m = openModal({ catalog: models(['base']) })
  assert.ok(m.modelDropdown())
  assert.equal(m.el('nr-model-notice').style.display, '')
  assert.equal(m.el('nr-start-btn').disabled, true)
  assert.equal(m.el('nr-import-btn').disabled, true)
})

test('Modal: a drop without the models imports nothing and says why', () => {
  const m = openModal({ catalog: models(['diarize']) })
  m.el('nr-modal').fire('drop', { preventDefault() {}, dataTransfer: { files: [{ path: '/a/call.wav' }] } })
  assert.deepEqual(m.calls.import, [])
  assert.deepEqual(m.toasts.map(t => t.text), ['No transcription model installed — download one in Settings'])
})

test('Modal: models not downloaded are disabled options; Start and Import on', () => {
  const m = openModal({ catalog: models(['base', 'diarize']) })
  const dd = m.modelDropdown()
  assert.equal(dd.value, 'base')
  assert.deepEqual(dd.options.map(o => [o.value, !!o.disabled]),
    [['tiny', true], ['base', false], ['small', true], ['medium', true], ['large-v3', true]])
  assert.equal(m.el('nr-model-notice').style.display, 'none')
  assert.equal(m.el('nr-start-btn').disabled, false)
  assert.equal(m.el('nr-import-btn').disabled, false)
})

test('Modal: a saved default that is not installed is not used', () => {
  const m = openModal({ settings: { transcribeModel: 'small' }, catalog: models(['diarize']) })
  assert.equal(m.el('nr-model-empty').textContent, 'No model installed')
})

test('Modal: opens from the last catalog, then follows a fresh GET /models', async () => {
  const m = openModal({ settings: { transcribeModel: null }, catalog: models(['diarize']), fresh: models(['tiny', 'diarize']) })
  assert.equal(m.el('nr-start-btn').disabled, true)
  await flush()
  assert.equal(m.modelDropdown().value, 'tiny')
  assert.equal(m.el('nr-start-btn').disabled, false)
  assert.deepEqual(m.toasts.map(t => t.text), ['Whisper Tiny is now the default transcription model'])
})

test('Modal: a model picked here is kept when the fresh list arrives', async () => {
  const m = openModal({ catalog: models(['base', 'medium', 'diarize']), fresh: models(['base', 'medium', 'diarize']) })
  m.modelDropdown().onChange('medium')
  await flush()
  assert.equal(m.modelDropdown().value, 'medium')
  m.el('nr-start-btn').fire('click')
  assert.equal(m.calls.start[0].model, 'medium')
})

// ── Settings → ML Models ───────────────────────────────────────────────────────

function settingsView({ settings = {}, catalog } = {}) {
  const created = []
  const saved = []
  const appSettings = { transcribeModel: null, transcribeModelHistory: [], transcribeLang: 'auto', ...settings }
  const ctx = loadRenderer(['utils.js', 'data.js', 'transcription-model.js', 'model-downloads.js', 'views/settings-view.js'], {
    API_BASE: 'http://api',
    appSettings,
    app: { _queue: null },
    document: { createElement: () => fakeElement(created) },
    window: { showToast() {} },
    fetch: pending,
    icon: () => '',
    makeDropdown: () => fakeElement(created),
    saveSettings: async patch => { saved.push(plain(patch)); Object.assign(appSettings, patch) },
  })
  if (catalog) seedModels(ctx, catalog)
  const state = ctx.makeSettings()
  ctx.buildModelsSection(state, () => {})
  state.refreshModels()
  return { ctx, state, created, saved, appSettings }
}


test('Settings: no Whisper model → a hint above the list, nothing "In use"', () => {
  const s = settingsView({ settings: { transcribeModel: 'small' }, catalog: models(['diarize']) })
  const hint = s.created.find(e => e.className === 'st-models-hint')
  assert.equal(hint.style.display, '')
  assert.match(hint.innerHTML, /No model selected — download a Whisper model to transcribe/)
  assert.equal(s.state.transcribeModel, null)
  assert.ok(!s.created.some(e => e.textContent === 'In use'))
})

test('Settings: no diarization model → its hint', () => {
  const s = settingsView({ settings: { transcribeModel: 'tiny' }, catalog: models(['tiny']) })
  const hint = s.created.find(e => e.className === 'st-models-hint')
  assert.match(hint.innerHTML, /Diarization model not installed — download it to transcribe/)
})

test('Settings: "In use" only on the installed default; the hint hidden', () => {
  const s = settingsView({ settings: { transcribeModel: 'tiny' }, catalog: models(['tiny', 'diarize']) })
  const hint = s.created.find(e => e.className === 'st-models-hint')
  assert.equal(hint.style.display, 'none')
  assert.equal(s.created.filter(e => e.textContent === 'In use').length, 1)
})

test('Settings: Use saves the default with its history', () => {
  const s = settingsView({ settings: { transcribeModel: 'tiny', transcribeModelHistory: ['tiny'] }, catalog: models(['tiny', 'base', 'diarize']) })
  const use = s.created.find(e => e.textContent === 'Use')
  use.fire('click')
  assert.deepEqual(s.saved, [{ transcribeModel: 'base', transcribeModelHistory: ['tiny', 'base'] }])
  assert.equal(s.state.transcribeModel, 'base')
})

// ── No built-in default ────────────────────────────────────────────────────────

test('No hard-coded default model in main.js, app.js or the modal', () => {
  for (const file of ['electron/main.js', 'electron/renderer/app.js', 'electron/renderer/views/new-recording-modal.js']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
    assert.doesNotMatch(src, /transcribeModel:\s*'[^']+'/, file)
    assert.doesNotMatch(src, /transcribeModel\s*\|\|\s*'/, file)
  }
})
