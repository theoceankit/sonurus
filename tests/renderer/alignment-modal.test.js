// Jobs whose language has no installed alignment model fail with
// alignment_model_missing, and every such failure used to open its own dialog
// with its own download (two queued jobs → two dialogs, two downloads, two
// Retry clicks). Now: one dialog per language, the download goes through
// model-downloads.js (one per model), and one button retries every job that
// failed for that model.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadRenderer } = require('./load-renderer')
const { fakeElement } = require('./fake-dom')
const { models } = require('./models-fixture')

const flush = () => new Promise(resolve => setImmediate(resolve))

function job(id, extra = {}) {
  return { id, title: id, status: 'failed', error_code: 'alignment_model_missing', error_language: 'ru', ...extra }
}

function setup({ installed = [], jobs = [] } = {}) {
  const env = { installed, requests: [], sockets: [], created: [], opened: [], retried: [] }
  class FakeWebSocket {
    constructor(url) { this.url = url; this.closed = false; env.sockets.push(this) }
    close() { this.closed = true }
    send(ev) { this.onmessage?.({ data: JSON.stringify(ev) }) }
  }
  const body = fakeElement()
  body.appendChild = el => {
    env.opened.push(el)
    el.isConnected = true
    el.remove = () => { el.isConnected = false }
  }
  env.ctx = loadRenderer(['utils.js', 'data.js', 'transcription-model.js', 'model-downloads.js', 'views/alignment-modal.js'], {
    appSettings: { transcribeModel: null, transcribeModelHistory: [], hfToken: 'hf_x' },
    app: {
      _queue: { type: 'snapshot', jobs },
      _queueRequest: async p => { env.retried.push(p); return {} },
    },
    WebSocket: FakeWebSocket,
    document: {
      body,
      createElement: () => fakeElement(env.created),
      addEventListener() {},
      removeEventListener() {},
    },
    window: { showToast() {} },
    icon: () => '',
    saveSettings: async () => {},
    fetch: async (url, opts = {}) => {
      env.requests.push({ url: String(url), method: opts.method || 'GET' })
      if (String(url).endsWith('/download')) return { ok: true, json: async () => ({ job_id: 'dl-1' }) }
      if (String(url).endsWith('/models')) return { ok: true, json: async () => models(env.installed) }
      return { ok: true, json: async () => ({}) }
    },
  })
  env.open = () => env.opened.filter(el => el.isConnected)
  env.downloads = () => env.requests.filter(r => r.method === 'POST' && r.url.endsWith('/download'))
  // Buttons of the dialog as it is drawn now: the last ones created with a label.
  env.button = label => [...env.created].reverse().find(el =>
    String(el.textContent ?? '').includes(label) || String(el.innerHTML ?? '').includes(label))
  env.socket = () => env.sockets[env.sockets.length - 1]
  return env
}

test('two failures of one language open one dialog; another language its own', async () => {
  const env = setup()
  await env.ctx.syncTranscribeModel()
  env.ctx.showAlignmentModal('ru')
  env.ctx.showAlignmentModal('ru')
  assert.equal(env.open().length, 1)
  env.ctx.showAlignmentModal('uk')
  assert.equal(env.open().length, 2)
})

test('after Dismiss the next failure opens the dialog again', async () => {
  const env = setup()
  await env.ctx.syncTranscribeModel()
  env.ctx.showAlignmentModal('ru')
  env.button('Dismiss').fire('click')
  assert.equal(env.open().length, 0)
  env.ctx.showAlignmentModal('ru')
  assert.equal(env.open().length, 1)
})

test('Download goes through model-downloads.js: one download, seen by a second failure', async () => {
  const env = setup()
  await env.ctx.syncTranscribeModel()
  env.ctx.showAlignmentModal('ru')
  assert.equal(env.ctx.alignmentModalState('ru'), 'offer')
  env.button('Download').fire('click')
  await flush()
  assert.equal(env.downloads().length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(env.ctx.modelDownload('ru'))), { pct: 0 })
  assert.equal(env.ctx.alignmentModalState('ru'), 'downloading')

  env.ctx.showAlignmentModal('ru')   // the next job fails meanwhile
  await flush()
  assert.equal(env.downloads().length, 1)
  assert.equal(env.open().length, 1)
})

test('a download started elsewhere (Settings) shows as progress, not as Download', async () => {
  const env = setup()
  await env.ctx.syncTranscribeModel()
  env.ctx.startModelDownload('ru')
  await flush()
  env.ctx.showAlignmentModal('ru')
  assert.equal(env.ctx.alignmentModalState('ru'), 'downloading')
  assert.ok(env.button('Cancel'), 'the dialog offers Cancel')
})

test('when the download is done one button retries every job that failed for that model', async () => {
  const env = setup({ jobs: [
    job('a'),
    job('other-lang', { error_language: 'uk' }),
    job('other-error', { error_code: 'whisper_model_missing' }),
    job('waiting', { status: 'waiting' }),
    job('b'),
  ] })
  await env.ctx.syncTranscribeModel()
  env.ctx.showAlignmentModal('ru')
  env.button('Download').fire('click')
  await flush()
  env.installed = ['ru']
  env.socket().send({ type: 'done' })
  await flush()
  assert.equal(env.ctx.alignmentModalState('ru'), 'ready')

  env.button('Retry 2 transcriptions').fire('click')
  await flush()
  assert.deepEqual(env.retried, ['/queue/jobs/a/retry', '/queue/jobs/b/retry'])
  assert.equal(env.open().length, 0)
})

test('retry label and job list', async () => {
  const env = setup()
  assert.equal(env.ctx.alignmentRetryLabel(1), 'Retry transcription')
  assert.equal(env.ctx.alignmentRetryLabel(3), 'Retry 3 transcriptions')
  assert.deepEqual(env.ctx.alignmentRetryJobs('ru', null).length, 0)
  const ids = env.ctx.alignmentRetryJobs('ru', { jobs: [job('a'), job('x', { error_language: 'uk' })] }).map(j => j.id)
  assert.deepEqual(ids, ['a'])
})

test('a model installed by the time the dialog opens is ready at once', async () => {
  const env = setup({ installed: ['ru'], jobs: [job('a')] })
  await env.ctx.syncTranscribeModel()
  env.ctx.showAlignmentModal('ru')
  assert.equal(env.ctx.alignmentModalState('ru'), 'ready')
  assert.ok(env.button('Retry transcription'))
})

test('a failed download says so and offers Download again', async () => {
  const env = setup()
  await env.ctx.syncTranscribeModel()
  env.ctx.showAlignmentModal('ru')
  env.button('Download').fire('click')
  await flush()
  env.socket().send({ type: 'error', message: 'boom' })
  await flush()
  assert.equal(env.ctx.alignmentModalState('ru'), 'failed')
  assert.ok(env.button('Download'), 'Download is offered again')
  assert.equal(env.open().length, 1)
})

test('Cancel stops the download and closes the dialog', async () => {
  const env = setup()
  await env.ctx.syncTranscribeModel()
  env.ctx.showAlignmentModal('ru')
  env.button('Download').fire('click')
  await flush()
  env.button('Cancel').fire('click')
  await flush()
  assert.ok(env.requests.some(r => r.method === 'DELETE' && r.url.endsWith('/models/ru/download/dl-1')))
  assert.equal(env.ctx.modelDownload('ru'), null)
  assert.equal(env.open().length, 0)
})

test('the queue opens the dialog through showAlignmentModal and refreshes it on snapshots', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'renderer', 'app.js'), 'utf8')
  assert.match(src, /alignment_model_missing'\) \{\s*showAlignmentModal\(event\.error_language\)/)
  assert.match(src, /refreshAlignmentModals\(\)/)
  assert.ok(!src.includes('renderAlignmentModal'), 'no dialog per failure')
})
