// Settings → GPU acceleration (gpu-acceleration.js): what the section shows for
// every state of GET /gpu, the download over WS /ws/gpu/{job}, and the restart
// of the backend once it says it may (POST /gpu/restart → ready).
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')
const { fakeElement } = require('./fake-dom')

const plain = v => JSON.parse(JSON.stringify(v))
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)) }

const RTX = { name: 'NVIDIA GeForce RTX 4060', driver: '615.78.08', compute_capability: '8.9' }
const status = over => ({
  blocked_reason: null, gpu: RTX, min_driver: '570', min_compute_capability: '7.0',
  state: 'not_installed', pending: null, error: null, download_size: 3920090829,
  device: 'cpu', torch: '2.8.0+cpu', ...over,
})

function setup({ statuses = [status()], restarts = [] } = {}) {
  const env = { requests: [], sockets: [], toasts: [], timers: [], restarted: 0, statuses, restarts }
  class FakeWebSocket {
    constructor(url) { this.url = url; this.closed = false; env.sockets.push(this) }
    close() { this.closed = true }
    send(ev) { this.onmessage?.({ data: JSON.stringify(ev) }) }
  }
  const respond = (body, statusCode = 200) => ({ ok: statusCode < 400, status: statusCode, json: async () => body })
  env.ctx = loadRenderer(['utils.js', 'gpu-acceleration.js', 'views/settings-view.js'], {
    WebSocket: FakeWebSocket,
    app: { _queue: null },
    appSettings: {},
    document: { createElement: () => fakeElement() },
    icon: name => `<i data-icon="${name}"></i>`,
    markNotImplemented: el => el,
    makeDropdown: () => fakeElement(),
    setTimeout: (fn, ms) => { env.timers.push({ fn, ms }); return env.timers.length },
    window: {
      showToast: (text, opts) => env.toasts.push([text, typeof opts === 'string' ? opts : opts?.tone ?? null]),
      electronAPI: { restartBackend: async () => { env.restarted++ } },
    },
    fetch: async (url, opts = {}) => {
      const method = opts.method || 'GET'
      url = String(url)
      env.requests.push(`${method} ${url.replace(/^https?:\/\/[^/]+/, '')}`)
      if (url.endsWith('/gpu') && method === 'GET') return respond(env.statuses.length > 1 ? env.statuses.shift() : env.statuses[0])
      if (url.endsWith('/gpu/download') && method === 'POST') return respond({ job_id: 'job-1' })
      if (url.endsWith('/gpu/restart')) {
        const next = env.restarts.shift() ?? { status: 'ready' }
        return next.code ? respond({ detail: 'x' }, next.code) : respond(next)
      }
      if (url.endsWith('/gpu/pack')) return respond(env.removeResult ?? { result: 'restart' })
      return respond({})
    },
  })
  env.socket = () => env.sockets[env.sockets.length - 1]
  env.tick = async () => { const t = env.timers.shift(); assert.ok(t, 'a timer is pending'); t.fn(); await flush() }
  return env
}

const view = (env, s, ui = {}) => plain(env.ctx.gpuSectionView(s, { download: null, restart: null, restarting: false, ...ui }))

// ── what the section shows ────────────────────────────────────────────────────

test('formatBytes', () => {
  const { ctx } = setup()
  assert.equal(ctx.formatGpuSize(3920090829), '3.9 GB')
  assert.equal(ctx.formatGpuSize(3470000000), '3.5 GB')
})

test('no section on macOS', () => {
  const env = setup()
  assert.equal(view(env, status({ blocked_reason: 'unsupported_platform', gpu: null })).hidden, true)
  assert.equal(view(env, null).hidden, true, 'nothing known yet')
})

test('development build: no download, only the device', () => {
  const env = setup()
  const v = view(env, status({ blocked_reason: 'not_packaged', device: 'cuda', torch: '2.8.0+cu128' }))
  assert.equal(v.hidden, false)
  assert.equal(v.label, 'Development build')
  assert.equal(v.device, 'GPU')
  assert.deepEqual(v.actions, [])
})

for (const [reason, gpu, label, detail] of [
  ['no_nvidia', null, 'No NVIDIA GPU found', /NVIDIA graphics card/],
  ['driver_too_old', { ...RTX, driver: '535.183.01' }, 'Driver update needed', /driver 535\.183\.01.*570 or newer/],
  ['gpu_too_old', { name: 'NVIDIA GeForce GTX 1060', driver: '581.29', compute_capability: '6.1' },
    'GPU not supported', /GTX 1060.*6\.1.*7\.0 or newer/],
]) {
  test(`blocked: ${reason} says why and offers no download`, () => {
    const env = setup()
    const v = view(env, status({ blocked_reason: reason, gpu }))
    assert.equal(v.label, label)
    assert.match(v.detail, detail)
    assert.equal(v.device, 'CPU')
    assert.deepEqual(v.actions, [])
  })
}

test('not installed: Download with its size', () => {
  const env = setup()
  const v = view(env, status())
  assert.equal(v.label, 'Not installed')
  assert.match(v.detail, /RTX 4060/)
  assert.deepEqual(v.actions, [{ id: 'download', label: 'Download (3.9 GB)', primary: true }])
})

test('downloading: progress and Cancel; installing has no percentage', () => {
  const env = setup()
  let v = view(env, status(), { download: { pct: 42, phase: 'download' } })
  assert.equal(v.label, 'Downloading')
  assert.deepEqual(v.progress, { pct: 42 })
  assert.deepEqual(v.actions, [{ id: 'cancel', label: 'Cancel', primary: false }])
  v = view(env, status(), { download: { pct: 100, phase: 'install' } })
  assert.equal(v.label, 'Installing')
  assert.equal(v.progress, null)
  assert.deepEqual(v.actions.map(a => a.id), ['cancel'])
})

for (const [reason, text] of [
  [null, /Restarting the transcription engine/],
  ['transcription', /after the current transcription/],
  ['recording', /after the recording/],
  ['model_download', /after the model download/],
]) {
  test(`waiting to restart (${reason ?? 'no reason yet'})`, () => {
    const env = setup()
    const v = view(env, status({ state: 'pending_restart', pending: 'install' }), { restart: { reason } })
    assert.equal(v.label, 'Waiting to apply')
    assert.match(v.detail, text)
    assert.deepEqual(v.actions, [])
  })
}

test('removal waiting to restart', () => {
  const env = setup()
  assert.equal(view(env, status({ state: 'pending_restart', pending: 'remove' }), { restart: { reason: null } }).label, 'Removing')
})

test('restarting', () => {
  const env = setup()
  assert.equal(view(env, status({ state: 'pending_restart', pending: 'install' }), { restarting: true }).label, 'Restarting')
})

test('active: runs on the GPU, can be removed', () => {
  const env = setup()
  const v = view(env, status({ state: 'active', device: 'cuda', torch: '2.8.0+cu128' }))
  assert.equal(v.label, 'On')
  assert.equal(v.tone, 'ok')
  assert.equal(v.device, 'GPU')
  assert.deepEqual(v.actions, [{ id: 'remove', label: 'Remove', primary: false }])
})

test('error: the reason, download again or remove', () => {
  const env = setup()
  const v = view(env, status({ state: 'error', error: 'CUDA is not available to PyTorch' }))
  assert.equal(v.label, 'GPU check failed')
  assert.equal(v.tone, 'error')
  assert.match(v.detail, /CUDA is not available to PyTorch.*CPU/)
  assert.deepEqual(v.actions.map(a => [a.id, a.label]), [['download', 'Download again (3.9 GB)'], ['remove', 'Remove']])
})

test('stale after an app update: download the update or remove', () => {
  const env = setup()
  const v = view(env, status({ state: 'stale' }))
  assert.equal(v.label, 'Update needed')
  assert.match(v.detail, /CPU/)
  assert.deepEqual(v.actions.map(a => [a.id, a.label]), [['download', 'Download update (3.9 GB)'], ['remove', 'Remove']])
})

test('an installed pack can be removed even when the GPU no longer qualifies', () => {
  const env = setup()
  const v = view(env, status({ state: 'error', error: 'x', blocked_reason: 'driver_too_old', gpu: { ...RTX, driver: '535.1' } }))
  assert.deepEqual(v.actions.map(a => a.id), ['remove'])
})

// ── download and restart ──────────────────────────────────────────────────────

test('download → progress → done → waits for the transcription → restarts → on', async () => {
  const env = setup({
    statuses: [status(), status({ state: 'pending_restart', pending: 'install' }),
      status({ state: 'active', device: 'cuda', torch: '2.8.0+cu128' })],
    restarts: [{ status: 'waiting', reason: 'transcription' }, { status: 'ready' }],
  })
  const seen = []
  env.ctx.subscribeGpu(() => seen.push(plain(env.ctx.gpuState())))
  await env.ctx.refreshGpuStatus()
  env.ctx.startGpuDownload()
  await flush()
  assert.deepEqual(env.requests.slice(0, 2), ['GET /gpu', 'POST /gpu/download'])
  assert.match(env.socket().url, /^ws:\/\/[^/]+\/ws\/gpu\/job-1$/)

  env.socket().send({ type: 'progress', phase: 'download', pct: 40, downloaded: 1, total: 2 })
  assert.deepEqual(plain(env.ctx.gpuState().download), { pct: 40, phase: 'download' })
  env.socket().send({ type: 'progress', phase: 'install' })
  assert.equal(env.ctx.gpuState().download.phase, 'install')
  env.socket().send({ type: 'done' })
  await flush()
  assert.equal(env.ctx.gpuState().download, null)
  assert.ok(env.socket().closed)
  assert.equal(env.ctx.gpuState().status.state, 'pending_restart')
  assert.ok(env.requests.includes('POST /gpu/restart'))
  assert.deepEqual(plain(env.ctx.gpuState().restart), { reason: 'transcription' })
  assert.equal(env.restarted, 0)

  await env.tick()
  assert.equal(env.restarted, 1)
  assert.equal(env.ctx.gpuState().status.state, 'active')
  assert.equal(env.ctx.gpuState().restart, null)
  assert.equal(env.ctx.gpuState().restarting, false)
  assert.deepEqual(env.toasts.at(-1), ['GPU acceleration is on', null])
  assert.ok(seen.some(s => s.restarting), 'subscribers saw the restart')
  assert.equal(env.timers.length, 0)
})

test('a failed check after the restart is reported', async () => {
  const env = setup({
    statuses: [status({ state: 'pending_restart', pending: 'install' }),
      status({ state: 'error', error: 'CUDA is not available to PyTorch' })],
  })
  await env.ctx.refreshGpuStatus()
  await flush()
  assert.equal(env.restarted, 1)
  assert.deepEqual(env.toasts.at(-1), ['GPU check failed: CUDA is not available to PyTorch. Transcription runs on the CPU.', 'error'])
})

test('cancel a download', async () => {
  const env = setup()
  await env.ctx.refreshGpuStatus()
  env.ctx.startGpuDownload()
  await flush()
  await env.ctx.cancelGpuDownload()
  assert.ok(env.requests.includes('DELETE /gpu/download/job-1'))
  env.socket().send({ type: 'cancelled' })
  await flush()
  assert.equal(env.ctx.gpuState().download, null)
})

test('a failed download shows its reason', async () => {
  const env = setup()
  await env.ctx.refreshGpuStatus()
  env.ctx.startGpuDownload()
  await flush()
  env.socket().send({ type: 'error', message: 'Not enough disk space: 11.8 GB needed, 5.0 GB free' })
  await flush()
  assert.equal(env.ctx.gpuState().download, null)
  assert.deepEqual(env.toasts.at(-1), ['GPU download failed: Not enough disk space: 11.8 GB needed, 5.0 GB free', 'error'])
})

test('remove an installed pack: restart, then CPU', async () => {
  const env = setup({
    statuses: [status({ state: 'active', device: 'cuda' }), status({ state: 'pending_restart', pending: 'remove' }),
      status({ state: 'not_installed' })],
  })
  await env.ctx.refreshGpuStatus()
  await env.ctx.removeGpuPack()
  await flush()
  assert.ok(env.requests.includes('DELETE /gpu/pack'))
  assert.equal(env.restarted, 1)
  assert.deepEqual(env.toasts.at(-1), ['GPU acceleration removed. Transcription runs on the CPU.', null])
})

test('remove a download not yet applied: no restart', async () => {
  const env = setup({ statuses: [status({ state: 'pending_restart', pending: 'install' }), status()],
    restarts: [{ status: 'waiting', reason: 'recording' }] })
  await env.ctx.refreshGpuStatus()
  await flush()
  env.removeResult = { result: 'removed' }
  await env.ctx.removeGpuPack()
  await flush()
  assert.equal(env.ctx.gpuState().status.state, 'not_installed')
  assert.equal(env.ctx.gpuState().restart, null, 'the restart is no longer needed')
  await env.tick()
  assert.equal(env.restarted, 0)
})

test('nothing left to apply stops the restart loop', async () => {
  const env = setup({ statuses: [status({ state: 'pending_restart', pending: 'install' }), status()],
    restarts: [{ code: 409 }] })
  await env.ctx.refreshGpuStatus()
  await flush()
  assert.equal(env.restarted, 0)
  assert.equal(env.ctx.gpuState().restart, null)
  assert.equal(env.timers.length, 0)
})

test('a restart that fails is reported and tried again later', async () => {
  const env = setup({ statuses: [status({ state: 'pending_restart', pending: 'install' })] })
  env.ctx.window.electronAPI.restartBackend = async () => { throw new Error('Backend did not respond within 60 seconds') }
  await env.ctx.refreshGpuStatus()
  await flush()
  assert.deepEqual(env.toasts.at(-1), ['Could not restart the transcription engine: Backend did not respond within 60 seconds', 'error'])
  assert.equal(env.ctx.gpuState().restarting, false)
})

// ── Settings section ──────────────────────────────────────────────────────────

test('buildGpuSection builds in every state', async () => {
  for (const s of [
    status(), status({ state: 'active', device: 'cuda' }), status({ state: 'error', error: 'x' }),
    status({ state: 'stale' }), status({ blocked_reason: 'no_nvidia', gpu: null }),
    status({ blocked_reason: 'not_packaged' }), status({ blocked_reason: 'unsupported_platform', gpu: null }),
  ]) {
    const env = setup({ statuses: [s] })
    const section = env.ctx.buildGpuSection()
    await flush()
    assert.ok(section, s.state)
  }
})

test('Settings lists the GPU section after alignment models', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'electron', 'renderer', 'views', 'settings-view.js'), 'utf8')
  assert.match(src, /id: 'alignment'.*\n\s*\{ id: 'gpu',\s+build: \(\) => buildGpuSection\(\) \}/)
})
