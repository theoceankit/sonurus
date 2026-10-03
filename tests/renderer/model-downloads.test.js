// Model downloads belong to the app (model-downloads.js): leaving Settings
// keeps them going, a finished one re-resolves the default model (with its
// toast) wherever the user is, and Settings shows them again on return.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')
const { fakeElement } = require('./fake-dom')
const { models } = require('./models-fixture')

const plain = v => JSON.parse(JSON.stringify(v))
// The whole Settings page reads its own markup back (querySelector).
const element = () => {
  const el = fakeElement()
  el.querySelector = () => fakeElement()
  return el
}
const flush = () => new Promise(resolve => setImmediate(resolve))

function setup({ settings = {}, installed = [] } = {}) {
  const env = { installed, requests: [], sockets: [], toasts: [] }
  const appSettings = { transcribeModel: null, transcribeModelHistory: [], hfToken: 'hf_x', ...settings }
  class FakeWebSocket {
    constructor(url) { this.url = url; this.closed = false; env.sockets.push(this) }
    close() { this.closed = true }
    send(ev) { this.onmessage?.({ data: JSON.stringify(ev) }) }
  }
  env.ctx = loadRenderer(['utils.js', 'data.js', 'transcription-model.js', 'model-downloads.js', 'views/settings-view.js'], {
    appSettings,
    app: { _queue: null },
    WebSocket: FakeWebSocket,
    document: { createElement: element },
    window: { showToast: text => env.toasts.push(text), electronAPI: { getAppVersion: async () => '1.0.0', getPlatform: async () => 'linux' } },
    icon: () => '',
    markNotImplemented() {},
    navigator: { mediaDevices: { enumerateDevices: async () => [] } },
    makeDropdown: () => fakeElement(),
    saveSettings: async patch => Object.assign(appSettings, patch),
    fetch: async (url, opts = {}) => {
      env.requests.push({ url: String(url), method: opts.method || 'GET', body: opts.body && JSON.parse(opts.body) })
      if (String(url).endsWith('/download')) return { ok: true, json: async () => ({ job_id: 'job-1' }) }
      if (String(url).endsWith('/models')) return { ok: true, json: async () => models(env.installed) }
      return { ok: true, json: async () => ({}) }
    },
  })
  env.socket = () => env.sockets[env.sockets.length - 1]
  return env
}

test('start: POST with the saved HF token, then WS /ws/models/{job_id}; subscribers see the progress', async () => {
  const env = setup()
  const seen = []
  env.ctx.subscribeModelDownloads(id => seen.push([id, plain(env.ctx.modelDownload(id))]))
  env.ctx.startModelDownload('tiny')
  assert.deepEqual(plain(env.ctx.modelDownload('tiny')), { pct: 0 })
  await flush()
  assert.deepEqual(env.requests[0], { url: 'http://localhost:8000/models/tiny/download', method: 'POST', body: { hf_token: 'hf_x' } })
  assert.equal(env.socket().url, 'ws://localhost:8000/ws/models/job-1')

  env.socket().send({ type: 'progress', pct: 42 })
  assert.deepEqual(seen, [['tiny', { pct: 0 }], ['tiny', { pct: 42 }]])
})

test('done: the default is re-resolved with its toast — no Settings page needed', async () => {
  const env = setup()
  await env.ctx.syncTranscribeModel()          // app start: nothing installed
  env.ctx.startModelDownload('tiny')
  await flush()
  env.installed = ['tiny']
  env.socket().send({ type: 'done' })
  await flush()
  assert.equal(env.ctx.modelDownload('tiny'), null)
  assert.equal(env.socket().closed, true)
  assert.deepEqual(env.toasts, ['Whisper Tiny is now the default transcription model'])
})

test('error / cancelled event → no longer downloading', async () => {
  for (const type of ['error', 'cancelled']) {
    const env = setup()
    env.ctx.startModelDownload('base')
    await flush()
    env.socket().send({ type })
    assert.equal(env.ctx.modelDownload('base'), null)
  }
})

test('cancel: DELETE the job, then no longer downloading', async () => {
  const env = setup()
  env.ctx.startModelDownload('base')
  await flush()
  await env.ctx.cancelModelDownload('base')
  assert.deepEqual(env.requests.at(-1), { url: 'http://localhost:8000/models/base/download/job-1', method: 'DELETE', body: undefined })
  assert.equal(env.ctx.modelDownload('base'), null)
  assert.equal(env.socket().closed, true)
})

test('cancel before the backend answered: the job it then starts is cancelled', async () => {
  const env = setup()
  env.ctx.startModelDownload('base')
  await env.ctx.cancelModelDownload('base')
  await flush()
  assert.equal(env.ctx.modelDownload('base'), null)
  assert.ok(env.requests.some(r => r.method === 'DELETE' && r.url.endsWith('/models/base/download/job-1')))
  assert.equal(env.sockets.length, 0)
})

test('Settings: leaving only unsubscribes; coming back shows the download and its progress', async () => {
  const env = setup({ installed: ['diarize'] })
  await env.ctx.syncTranscribeModel()
  const first = env.ctx.renderSettingsView()
  await flush()
  env.ctx.startModelDownload('tiny')
  await flush()
  first._cleanup()
  assert.equal(env.socket().closed, false)

  env.socket().send({ type: 'progress', pct: 60 })
  const state = env.ctx.makeSettings()
  env.ctx.buildModelsSection(state, () => {})
  state.refreshModels()
  assert.equal(state.modelStatus.tiny, 'downloading')
  assert.equal(state.modelProgress.tiny, 60)
  assert.equal(state.modelStatus.diarize, 'installed')
})
