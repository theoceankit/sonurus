// Deleting a model the queue needs: a confirmation when waiting / failed jobs
// use it, no delete while the running transcription uses it; queue cards name
// a missing model; the queue job modal cannot pick a model not downloaded.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')
const { fakeElement } = require('./fake-dom')
const { models, seedModels } = require('./models-fixture')

const plain = v => JSON.parse(JSON.stringify(v))
const pending = () => new Promise(() => {})
const flush = () => new Promise(resolve => setImmediate(resolve))

const SMALL = { id: 'small', name: 'Whisper Small', kind: 'whisper' }
const DIARIZE = { id: 'diarize', name: 'Diarization · v2', kind: 'diarization' }
const RU = { id: 'ru', name: 'Russian', kind: 'alignment' }

const job = (id, status, whisper_model = 'small') => ({ id, status, whisper_model, title: id })
const snapshot = (jobs, running_job_id = null) => ({ jobs, running_job_id })

// ── Helpers ────────────────────────────────────────────────────────────────────

const pure = loadRenderer(['utils.js', 'transcription-model.js'])

test('queuedJobsUsingModel: waiting and failed jobs of that Whisper model; every job for diarization', () => {
  const q = snapshot([job('a', 'waiting'), job('b', 'failed'), job('c', 'waiting', 'base'), job('d', 'running')], 'd')
  assert.equal(pure.queuedJobsUsingModel(SMALL, q), 2)
  assert.equal(pure.queuedJobsUsingModel(DIARIZE, q), 3)
  assert.equal(pure.queuedJobsUsingModel(RU, q), 0)
  assert.equal(pure.queuedJobsUsingModel(SMALL, null), 0)
})

test('modelInUseByRunningJob: its Whisper model and the diarization model', () => {
  const q = snapshot([job('a', 'running', 'small'), job('b', 'waiting', 'base')], 'a')
  assert.equal(pure.modelInUseByRunningJob(SMALL, q), true)
  assert.equal(pure.modelInUseByRunningJob(DIARIZE, q), true)
  assert.equal(pure.modelInUseByRunningJob({ id: 'base', name: 'Whisper Base', kind: 'whisper' }, q), false)
  assert.equal(pure.modelInUseByRunningJob(SMALL, snapshot([job('a', 'waiting')])), false)
  assert.equal(pure.modelInUseByRunningJob(SMALL, null), false)
})

test('modelDeletePrompt: texts; none without queued jobs', () => {
  assert.equal(pure.modelDeletePrompt(SMALL, 0), null)
  assert.deepEqual(plain(pure.modelDeletePrompt(SMALL, 1)),
    { title: 'Delete Whisper Small?', body: '1 job in the queue uses Whisper Small. Delete anyway?' })
  assert.deepEqual(plain(pure.modelDeletePrompt(SMALL, 2)),
    { title: 'Delete Whisper Small?', body: '2 jobs in the queue use Whisper Small. Delete anyway?' })
})

test('jobStatusText: a missing Whisper or diarization model', () => {
  const q = { paused: false }
  const error = 'Whisper model "small" is not installed. Download it in Settings.'
  assert.equal(pure.jobStatusText({ status: 'failed', error_code: 'whisper_model_missing', whisper_model: 'small', error }, q),
    'Whisper model "small" is not installed')
  assert.equal(pure.jobStatusText({ status: 'failed', error_code: 'diarization_model_missing', whisper_model: 'small', error: 'x' }, q),
    'Diarization model is not installed')
})

test('jobStatusText: names the model the job failed on, not the one picked since', () => {
  // Editing a failed job changes its model but keeps the error until Retry.
  const q = { paused: false }
  const error = 'Whisper model "small" is not installed. Download it in Settings.'
  assert.equal(pure.jobStatusText({ status: 'failed', error_code: 'whisper_model_missing', whisper_model: 'large-v3', error }, q),
    'Whisper model "small" is not installed')
  assert.equal(pure.jobStatusText({ status: 'failed', error_code: 'whisper_model_missing', whisper_model: 'large-v3', error: '' }, q),
    'Whisper model is not installed')
})

// ── Settings → delete ──────────────────────────────────────────────────────────

function settings(queue) {
  const created = []
  const requests = []
  const dialogs = []
  const toasts = []
  const appSettings = { transcribeModel: 'small', transcribeModelHistory: ['small'], transcribeLang: 'auto' }
  const ctx = loadRenderer(['utils.js', 'data.js', 'transcription-model.js', 'model-downloads.js', 'views/settings-view.js'], {
    API_BASE: 'http://api',
    appSettings,
    app: { _queue: queue },
    document: { createElement: () => fakeElement(created) },
    window: { showToast: (text, tone) => toasts.push({ text, tone }) },
    icon: () => '',
    makeDropdown: () => fakeElement(created),
    openConfirmDialog: opts => dialogs.push(opts),
    saveSettings: async patch => Object.assign(appSettings, patch),
    fetch: async (url, opts = {}) => {
      requests.push(`${opts.method || 'GET'} ${url}`)
      if (opts.method === 'DELETE' && queue.refuse) return { ok: false, status: 409, json: async () => ({ detail: 'In use by the running transcription' }) }
      return { ok: true, json: async () => models(['small', 'base', 'diarize']) }
    },
  })
  seedModels(ctx, models(['small', 'base', 'diarize']))
  const state = ctx.makeSettings()
  ctx.buildModelsSection(state, () => {})
  state.refreshModels()
  // The delete button of a freshly built row.
  const deleteButtonOf = id => {
    state.refreshModels()
    const before = created.length
    ctx.makeModelRow(models(['small', 'base', 'diarize']).find(m => m.id === id), state, () => {}, () => {}, ctx._makeDeleteHandler(state))
    return created.slice(before).find(e => e.className === 'st-btn st-btn--icon')
  }
  return { ctx, state, requests, dialogs, toasts, deleteButtonOf }
}

const deletes = requests => requests.filter(r => r.startsWith('DELETE'))

test('Settings: no queued job needs the model → deleted at once', async () => {
  const s = settings(snapshot([job('a', 'waiting', 'base')]))
  s.deleteButtonOf('small').fire('click')
  await flush()
  assert.deepEqual(s.dialogs, [])
  assert.deepEqual(deletes(s.requests), ['DELETE http://localhost:8000/models/small'])
})

test('Settings: queued jobs need the model → confirmation; Cancel deletes nothing, Delete deletes', async () => {
  const s = settings(snapshot([job('a', 'waiting'), job('b', 'failed')]))
  s.deleteButtonOf('small').fire('click')
  assert.equal(s.dialogs.length, 1)
  assert.equal(s.dialogs[0].title, 'Delete Whisper Small?')
  assert.equal(s.dialogs[0].body, '2 jobs in the queue use Whisper Small. Delete anyway?')
  assert.equal(s.dialogs[0].confirmLabel, 'Delete')
  assert.deepEqual(deletes(s.requests), [])          // Cancel = the dialog just closes

  await s.dialogs[0].onConfirm()
  assert.deepEqual(deletes(s.requests), ['DELETE http://localhost:8000/models/small'])
})

test('Settings: the diarization model with queued jobs → confirmation counting every job', () => {
  const s = settings(snapshot([job('a', 'waiting', 'small'), job('b', 'waiting', 'base')]))
  s.deleteButtonOf('diarize').fire('click')
  assert.equal(s.dialogs[0].body, '2 jobs in the queue use Diarization · v2. Delete anyway?')
})

test('Settings: the running transcription uses the model → delete button off with the reason', () => {
  const s = settings(snapshot([job('a', 'running', 'small')], 'a'))
  for (const id of ['small', 'diarize']) {
    const btn = s.deleteButtonOf(id)
    assert.equal(btn.disabled, true, id)
    assert.equal(btn.title, 'In use by the running transcription')
    btn.fire('click')
  }
  assert.deepEqual(s.dialogs, [])
  assert.deepEqual(deletes(s.requests), [])
  const base = s.deleteButtonOf('base')
  assert.equal(base.disabled, false)
  assert.equal(base.title, 'Remove')
})

test('Settings: a 409 from the backend (race) → its message as a toast', async () => {
  const q = snapshot([])
  q.refuse = true
  const s = settings(q)
  s.deleteButtonOf('base').fire('click')
  await flush()
  assert.deepEqual(s.toasts, [{ text: 'In use by the running transcription', tone: 'error' }])
})

// ── Queue job modal ────────────────────────────────────────────────────────────

function jobModal(jobRow, catalog) {
  const created = []
  const dropdowns = []
  const ctx = loadRenderer(['utils.js', 'data.js', 'transcription-model.js', 'views/queue-job-modal.js'], {
    API_BASE: 'http://api',
    appSettings: { transcribeModel: 'base' },
    document: {
      createElement: () => fakeElement(created),
      addEventListener() {}, removeEventListener() {},
      body: { appendChild() {} },
    },
    window: {},
    fetch: pending,
    icon: () => '',
    makeDropdown: (options, value, onChange) => { dropdowns.push({ options: plain(options), value, onChange }); return fakeElement(created) },
  })
  if (catalog) seedModels(ctx, catalog)
  ctx.openJobEditModal({ job: jobRow, onSubmit: async () => {} })
  return dropdowns.find(d => d.options.some(o => o.value === jobRow.whisper_model))
}

test('Queue job modal: models not downloaded are disabled options', () => {
  const dd = jobModal({ id: 'a', title: 'A', whisper_model: 'base', language: null }, models(['tiny', 'base', 'diarize']))
  assert.equal(dd.value, 'base')
  assert.deepEqual(dd.options.map(o => [o.value, !!o.disabled]),
    [['tiny', false], ['base', false], ['small', true], ['medium', true], ['large-v3', true]])
})

test('Queue job modal: a deleted model of the job stays shown, disabled', () => {
  const dd = jobModal({ id: 'a', title: 'A', whisper_model: 'small', language: null }, models(['base', 'diarize']))
  assert.equal(dd.value, 'small')
  assert.equal(dd.options.find(o => o.value === 'small').disabled, true)
})
