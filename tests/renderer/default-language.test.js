// Default language without its alignment model (ru, uk, zh, ja need one; en,
// es, de, fr and Detect do not): Settings warns and offers the download, the
// New Recording modal and window drops start nothing, deleting the default
// language's model resets it to Detect, queued jobs by language are counted.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')
const { fakeElement } = require('./fake-dom')
const { models, seedModels, modelsFetch } = require('./models-fixture')

const plain = v => JSON.parse(JSON.stringify(v))
const pending = () => new Promise(() => {})
const flush = () => new Promise(resolve => setImmediate(resolve))

const READY = ['base', 'diarize']            // Whisper + diarization, no alignment model
const RU = { id: 'ru', name: 'Russian', kind: 'alignment' }

// ── Helpers ────────────────────────────────────────────────────────────────────

const pure = loadRenderer(['utils.js', 'data.js', 'transcription-model.js'], { appSettings: { transcribeModel: 'base' } })

test('missingAlignmentModel: only languages of the catalog whose model is not installed', () => {
  assert.equal(pure.missingAlignmentModel('ru', models(READY)).id, 'ru')
  assert.equal(pure.missingAlignmentModel('ru', models([...READY, 'ru'])), null)
  for (const lang of ['en', 'de', 'auto', null]) assert.equal(pure.missingAlignmentModel(lang, models(READY)), null, lang)
})

test('jobBlockMessage: Whisper, then diarization, then the language', () => {
  const state = installed => pure.modelState(models(installed))
  assert.equal(pure.jobBlockMessage(state(['diarize']), 'ru'), 'No transcription model installed — download one in Settings')
  assert.equal(pure.jobBlockMessage(state(['base']), 'ru'), 'Diarization model not installed — download it in Settings')
  assert.equal(pure.jobBlockMessage(state(READY), 'ru'), 'Alignment model for Русский is not installed — download it in Settings')
  assert.equal(pure.jobBlockMessage(state(READY), 'en'), null)
  assert.equal(pure.jobBlockMessage(state([...READY, 'ru']), 'ru'), null)
})

test('queuedJobsUsingModel / modelInUseByRunningJob: alignment models by the job language', () => {
  const jobs = [
    { id: 'a', status: 'waiting', whisper_model: 'base', language: 'ru' },
    { id: 'b', status: 'failed', whisper_model: 'base', language: 'ru' },
    { id: 'c', status: 'waiting', whisper_model: 'base', language: null },
    { id: 'd', status: 'running', whisper_model: 'base', language: 'ru' },
  ]
  assert.equal(pure.queuedJobsUsingModel(RU, { jobs, running_job_id: 'd' }), 2)
  assert.equal(pure.modelInUseByRunningJob(RU, { jobs, running_job_id: 'd' }), true)
  assert.equal(pure.modelInUseByRunningJob(RU, { jobs, running_job_id: 'c' }), false)   // auto-detect
  assert.deepEqual(plain(pure.modelDeletePrompt(RU, 2)),
    { title: 'Delete Russian?', body: '2 jobs in the queue use Russian. Delete anyway?' })
})

// ── Window drops ───────────────────────────────────────────────────────────────

function dropEnv(lang, installed) {
  const toasts = []
  const ctx = loadRenderer(['utils.js', 'data.js', 'transcription-model.js'], {
    appSettings: { transcribeModel: 'base', transcribeModelHistory: ['base'], transcribeLang: lang },
    app: { showSettings() {} },
    window: { showToast: (text, opts) => toasts.push({ text, opts }) },
    fetch: modelsFetch(() => models(installed)),
    saveSettings: async () => {},
  })
  return { ctx, toasts }
}

test('Window drop: the default language without its model → nothing queued, a toast that opens Settings', async () => {
  const d = dropEnv('ru', READY)
  assert.equal(await d.ctx.dropImportOptions(), null)
  assert.equal(d.toasts[0].text, 'Alignment model for Русский is not installed — download it in Settings')
  assert.equal(d.toasts[0].opts.actionLabel, 'Open Settings')
})

test('Window drop: a language without a catalog model, or with it installed → imported', async () => {
  assert.deepEqual(plain(await dropEnv('en', READY).ctx.dropImportOptions()), { model: 'base', language: 'en' })
  assert.deepEqual(plain(await dropEnv('ru', [...READY, 'ru']).ctx.dropImportOptions()), { model: 'base', language: 'ru' })
})

// ── New Recording modal ────────────────────────────────────────────────────────

function openModal(lang, installed) {
  const created = []
  const dropdowns = []
  const toasts = []
  const calls = { start: [], import: [] }
  const ctx = loadRenderer(['utils.js', 'data.js', 'transcription-model.js', 'views/new-recording-modal.js'], {
    appSettings: { transcribeModel: 'base', transcribeLang: lang },
    app: { showSettings() {} },
    document: { createElement: () => fakeElement(created), addEventListener() {}, removeEventListener() {} },
    window: {
      electronAPI: { getPlatform: pending, openFiles: async () => ['/a/call.wav'], getFilePath: f => f.path },
      showToast: text => toasts.push(text),
    },
    navigator: {},
    fetch: pending,
    setTimeout,
    icon: () => '',
    markNotImplemented() {},
    saveSettings: async () => {},
    makeDropdown: (options, value, onChange) => { dropdowns.push({ options: plain(options), value, onChange }); return fakeElement(created) },
  })
  seedModels(ctx, models(installed))
  ctx.renderNewRecordingModal({ onStart: s => calls.start.push(plain(s)), onImport: a => calls.import.push(plain(a)) })
  const el = cls => created.find(e => e.className === cls)
  const langDropdown = () => [...dropdowns].reverse().find(d => d.options.some(o => o.value === 'auto'))
  return { el, calls, toasts, langDropdown }
}

test('Modal: languages whose model is not installed are disabled options', () => {
  const m = openModal('en', READY)
  const disabled = m.langDropdown().options.filter(o => o.disabled).map(o => o.value).sort()
  assert.deepEqual(disabled, ['ja', 'ru', 'uk', 'zh'])
  assert.equal(m.el('nr-start-btn').disabled, false)
})

test('Modal: the default language without its model → notice, Start and Import off, a drop refused', () => {
  const m = openModal('ru', READY)
  assert.equal(m.langDropdown().value, 'ru')
  assert.equal(m.el('nr-model-notice').style.display, '')
  assert.equal(m.el('nr-start-btn').disabled, true)
  assert.equal(m.el('nr-import-btn').disabled, true)
  m.el('nr-modal').fire('drop', { preventDefault() {}, dataTransfer: { files: [{ path: '/a/call.wav' }] } })
  assert.deepEqual(m.calls.import, [])
  assert.deepEqual(m.toasts, ['Alignment model for Русский is not installed — download it in Settings'])
})

test('Modal: picking Detect unblocks; the job gets the picked language', () => {
  const m = openModal('ru', READY)
  m.langDropdown().onChange('auto')
  assert.equal(m.el('nr-model-notice').style.display, 'none')
  assert.equal(m.el('nr-start-btn').disabled, false)
  m.el('nr-start-btn').fire('click')
  assert.equal(m.calls.start[0].language, 'auto')
})

// ── Settings ───────────────────────────────────────────────────────────────────

function settings({ lang = 'ru', installed = READY, queue = { jobs: [], running_job_id: null } } = {}) {
  const created = []
  const toasts = []
  const requests = []
  const dialogs = []
  const env = { installed }
  const appSettings = { transcribeModel: 'base', transcribeModelHistory: ['base'], transcribeLang: lang }
  const ctx = loadRenderer(['utils.js', 'data.js', 'transcription-model.js', 'model-downloads.js', 'views/settings-view.js'], {
    appSettings,
    app: { _queue: queue },
    WebSocket: class { close() {} },
    document: { createElement: () => fakeElement(created) },
    window: { showToast: (text, tone) => toasts.push(text) },
    icon: () => '',
    makeDropdown: () => fakeElement(created),
    openConfirmDialog: opts => dialogs.push(opts),
    saveSettings: async patch => Object.assign(appSettings, patch),
    fetch: async (url, opts = {}) => {
      requests.push(`${opts.method || 'GET'} ${url}`)
      if (String(url).endsWith('/download')) return { ok: true, json: async () => ({ job_id: 'job-1' }) }
      if (opts.method === 'DELETE') { env.installed = env.installed.filter(id => !String(url).endsWith('/' + id)); return { ok: true, json: async () => ({}) } }
      return { ok: true, json: async () => models(env.installed) }
    },
  })
  seedModels(ctx, models(installed))
  const state = ctx.makeSettings()
  ctx.buildModelsSection(state, () => {})
  ctx.buildAlignmentSection(state)
  state.refreshModels()
  const warning = () => [...created].reverse().find(e => e.className === 'st-lang-warning')
  return { ctx, state, created, toasts, requests, dialogs, appSettings, warning, env }
}

test('Settings: the default language without its model → a warning with Download (size)', () => {
  const s = settings()
  assert.equal(s.warning().style.display, '')
  assert.match(s.warning().innerHTML + s.created.map(e => e.textContent).join('|'), /Alignment model for Русский is not installed/)
  const download = s.created.find(e => typeof e.textContent === 'string' && e.textContent.startsWith('Download ('))
  assert.ok(download, 'a Download button')
  download.fire('click')
  assert.ok(s.ctx.modelDownload('ru'))
})

test('Settings: no warning for a language that needs no model or has it', () => {
  assert.equal(settings({ lang: 'en' }).warning().style.display, 'none')
  assert.equal(settings({ installed: [...READY, 'ru'] }).warning().style.display, 'none')
})

test('Settings: deleting the default language\'s model resets it to Detect, with a toast', async () => {
  const s = settings({ installed: [...READY, 'ru'] })
  s.ctx._makeDeleteHandler(s.state)('ru')
  await flush(); await flush()
  assert.equal(s.appSettings.transcribeLang, 'auto')
  assert.equal(s.state.transcribeLang, 'auto')
  assert.ok(s.toasts.includes('Default language changed to Detect automatically'))
})

test('Settings: deleting another language\'s model keeps the default language', async () => {
  const s = settings({ lang: 'en', installed: [...READY, 'ru'] })
  s.ctx._makeDeleteHandler(s.state)('ru')
  await flush(); await flush()
  assert.equal(s.appSettings.transcribeLang, 'en')
  assert.ok(!s.toasts.includes('Default language changed to Detect automatically'))
})

test('Settings: an alignment model queued jobs need asks first; the running job\'s one cannot be deleted', () => {
  const queue = { jobs: [{ id: 'a', status: 'waiting', whisper_model: 'base', language: 'ru' }], running_job_id: null }
  const s = settings({ lang: 'en', installed: [...READY, 'ru'], queue })
  s.ctx._makeDeleteHandler(s.state)('ru')
  assert.equal(s.dialogs[0].body, '1 job in the queue uses Russian. Delete anyway?')

  queue.jobs[0].status = 'running'
  queue.running_job_id = 'a'
  const before = s.created.length
  s.ctx.makeAlignmentModelRow({ id: 'ru', kind: 'alignment', lang: 'ru', name: 'Russian', nativeName: 'Русский', size: '~1.3 GB' },
    s.state, () => {}, s.ctx._makeDeleteHandler(s.state))
  const btn = s.created.slice(before).find(e => e.className === 'st-btn st-btn--icon')
  assert.equal(btn.disabled, true)
  assert.equal(btn.title, 'In use by the running transcription')
})
