// Transcription model and language: Settings holds the defaults (saved to
// settings.json); the New Recording modal starts from them and its own choice
// applies to that recording or import only.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')
const { fakeElement } = require('./fake-dom')

const pending = () => new Promise(() => {})
const flush = () => new Promise(resolve => setImmediate(resolve))

function setup(settings = {}) {
  const created = []
  const dropdowns = []
  const saved = []
  const appSettings = { transcribeModel: 'medium', transcribeLang: 'de', ...settings }
  const ctx = loadRenderer(['data.js', 'views/settings-view.js', 'views/new-recording-modal.js'], {
    API_BASE: 'http://api',
    appSettings,
    app: { _queue: null },
    document: {
      createElement: () => fakeElement(created),
      addEventListener() {},
      removeEventListener() {},
    },
    window: {
      electronAPI: { getPlatform: pending, openFiles: async () => ['/audio/call.wav'] },
    },
    navigator: {},
    fetch: pending,
    setTimeout,
    icon: () => '',
    markNotImplemented() {},
    listSystemAudioSources: pending,
    isSupportedAudio: () => true,
    saveSettings: patch => { saved.push(patch); Object.assign(appSettings, patch) },
    makeDropdown: (options, value, onChange) => {
      const dropdown = { values: options.map(o => o.value), value, onChange }
      dropdowns.push(dropdown)
      return fakeElement(created)
    },
  })
  const find = (list, v) => list.find(d => d.values.includes(v))
  return {
    ctx, appSettings, saved, created,
    langDropdown: () => find(dropdowns, 'ru'),
    modelDropdown: () => find(dropdowns, 'large-v3'),
    button: cls => created.find(el => el.className === cls),
  }
}

const settingsState = appSettings => ({
  transcribeLang: appSettings.transcribeLang,
  transcribeModel: appSettings.transcribeModel,
  modelStatus: {}, activeDownload: {}, modelProgress: {},
})

// ── Settings → ML Models ───────────────────────────────────────────────────────

test('Settings: picking a transcription language saves it as the default', () => {
  const s = setup()
  const state = settingsState(s.appSettings)
  s.ctx.buildModelsSection(state, () => {})
  assert.equal(s.langDropdown().value, 'de')

  s.langDropdown().onChange('ru')

  assert.equal(state.transcribeLang, 'ru')
  assert.deepEqual(s.saved.map(p => ({ ...p })), [{ transcribeLang: 'ru' }])
  assert.equal(s.appSettings.transcribeLang, 'ru')
})

// ── New Recording modal ────────────────────────────────────────────────────────

function openModal(s) {
  const calls = { start: [], import: [] }
  s.ctx.renderNewRecordingModal({
    onStart: settings => calls.start.push(settings),
    onImport: args => calls.import.push(args),
  })
  return calls
}

test('Modal: starts from the default model and language', () => {
  const s = setup()
  openModal(s)
  assert.equal(s.modelDropdown().value, 'medium')
  assert.equal(s.langDropdown().value, 'de')
})

test('Modal: changing model or language does not touch the defaults', () => {
  const s = setup()
  openModal(s)

  s.modelDropdown().onChange('small')
  s.langDropdown().onChange('ru')

  assert.deepEqual(s.saved, [])
  assert.equal(s.appSettings.transcribeModel, 'medium')
  assert.equal(s.appSettings.transcribeLang, 'de')
})

test('Modal: an import uses the model and language chosen in the modal', async () => {
  const s = setup()
  const calls = openModal(s)
  s.modelDropdown().onChange('small')
  s.langDropdown().onChange('ru')

  s.button('nr-import-btn').fire('click')
  await flush()

  assert.equal(calls.import.length, 1)
  assert.equal(calls.import[0].items[0].filePath, '/audio/call.wav')
  assert.equal(calls.import[0].model, 'small')
  assert.equal(calls.import[0].language, 'ru')
  assert.deepEqual(s.saved, [])
})

test('Modal: a recording uses the chosen model and language; only source and devices are saved', () => {
  const s = setup()
  const calls = openModal(s)
  s.modelDropdown().onChange('small')
  s.langDropdown().onChange('ru')

  s.button('nr-start-btn').fire('click')

  assert.equal(calls.start.length, 1)
  assert.equal(calls.start[0].model, 'small')
  assert.equal(calls.start[0].language, 'ru')
  assert.equal(s.saved.length, 1)
  assert.ok(!('transcribeModel' in s.saved[0]))
  assert.ok(!('transcribeLang' in s.saved[0]))
  assert.equal(s.appSettings.transcribeModel, 'medium')
  assert.equal(s.appSettings.transcribeLang, 'de')
})
