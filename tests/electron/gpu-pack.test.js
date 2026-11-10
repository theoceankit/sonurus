// GPU acceleration in the Electron main process (electron/gpu-pack.js): before
// every backend start the app applies a finished download or a removal (the
// backend never replaces files it has loaded), checks a new pack with
// app.gpu_probe and starts the backend with or without it on PYTHONPATH.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const gp = require(path.join(ROOT, 'electron', 'gpu-pack.js'))

const MANIFEST = { torch: '2.8.0+cu128', total_size: 3920000000 }

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-gpu-'))
  const gpuDir = path.join(dir, 'gpu')
  const p = name => path.join(gpuDir, name)
  return {
    gpuDir, p,
    write(name, content = '') { fs.mkdirSync(path.dirname(p(name)), { recursive: true }); fs.writeFileSync(p(name), content) },
    json(name) { return JSON.parse(fs.readFileSync(p(name), 'utf8')) },
    exists(name) { return fs.existsSync(p(name)) },
    done() { fs.rmSync(dir, { recursive: true, force: true }) },
  }
}

function installed(t, packJson) {
  t.write('pack/torch/__init__.py', 'old')
  t.write('pack.json', JSON.stringify({ torch: '2.8.0+cu128', status: 'ok', probed_for_app_version: '0.3.0', ...packJson }))
}

function downloaded(t, torch = '2.8.0+cu128') {
  t.write('incoming/pack/torch/__init__.py', 'new')
  t.write('incoming/ready.json', JSON.stringify({ torch }))
}

// ── applyPendingOps ───────────────────────────────────────────────────────────

test('applyPendingOps: nothing to do', () => {
  const t = tmp()
  try {
    assert.equal(gp.applyPendingOps(t.gpuDir), null)
    installed(t)
    assert.equal(gp.applyPendingOps(t.gpuDir), null)
    assert.ok(t.exists('pack/torch/__init__.py'))
  } finally { t.done() }
})

test('applyPendingOps: a removal deletes the pack, its record and the marker', () => {
  const t = tmp()
  try {
    installed(t)
    t.write('remove')
    assert.equal(gp.applyPendingOps(t.gpuDir), 'removed')
    assert.ok(!t.exists('pack'))
    assert.ok(!t.exists('pack.json'))
    assert.ok(!t.exists('remove'))
  } finally { t.done() }
})

test('applyPendingOps: a finished download replaces the pack and waits for its check', () => {
  const t = tmp()
  try {
    installed(t, { status: 'error', error: 'old' })
    downloaded(t)
    assert.equal(gp.applyPendingOps(t.gpuDir), 'installed')
    assert.equal(fs.readFileSync(t.p('pack/torch/__init__.py'), 'utf8'), 'new')
    assert.ok(!t.exists('incoming'))
    assert.deepEqual(t.json('pack.json'), { torch: '2.8.0+cu128', status: 'unchecked' })
  } finally { t.done() }
})

test('applyPendingOps: an unfinished download is cleared', () => {
  const t = tmp()
  try {
    t.write('incoming/wheels/torch.whl.part', 'half')
    assert.equal(gp.applyPendingOps(t.gpuDir), null)
    assert.ok(!t.exists('incoming'))
  } finally { t.done() }
})

// ── prepareGpuStart ───────────────────────────────────────────────────────────

function probeStub(result) {
  const calls = []
  const probe = async packDir => { calls.push(packDir); return result }
  return { probe, calls }
}

test('prepareGpuStart: no pack → CPU, no check', async () => {
  const t = tmp()
  try {
    const { probe, calls } = probeStub({ ok: true })
    assert.deepEqual(await gp.prepareGpuStart({ gpuDir: t.gpuDir, manifest: MANIFEST, appVersion: '0.3.0', probe }),
      { usePack: false, applied: null, probe: null })
    assert.deepEqual(calls, [])
  } finally { t.done() }
})

test('prepareGpuStart: a new pack is checked and used when the check passes', async () => {
  const t = tmp()
  try {
    downloaded(t)
    const { probe, calls } = probeStub({ ok: true, torch: '2.8.0+cu128', device: 'RTX 4060', error: null })
    const out = await gp.prepareGpuStart({ gpuDir: t.gpuDir, manifest: MANIFEST, appVersion: '0.3.0', probe })
    assert.equal(out.usePack, true)
    assert.equal(out.applied, 'installed')
    assert.deepEqual(calls, [t.p('pack')])
    assert.deepEqual(t.json('pack.json'), { torch: '2.8.0+cu128', status: 'ok', error: null, probed_for_app_version: '0.3.0' })
  } finally { t.done() }
})

test('prepareGpuStart: a failed check keeps the backend on the CPU and records why', async () => {
  const t = tmp()
  try {
    downloaded(t)
    const { probe } = probeStub({ ok: false, error: 'CUDA is not available to PyTorch' })
    const out = await gp.prepareGpuStart({ gpuDir: t.gpuDir, manifest: MANIFEST, appVersion: '0.3.0', probe })
    assert.equal(out.usePack, false)
    assert.equal(out.probe.ok, false)
    assert.deepEqual(t.json('pack.json'), {
      torch: '2.8.0+cu128', status: 'error', error: 'CUDA is not available to PyTorch', probed_for_app_version: '0.3.0',
    })
    assert.ok(t.exists('pack'), 'the files stay; the user removes or downloads again')
  } finally { t.done() }
})

test('prepareGpuStart: a checked pack is used without a new check', async () => {
  const t = tmp()
  try {
    installed(t)
    const { probe, calls } = probeStub({ ok: false })
    assert.equal((await gp.prepareGpuStart({ gpuDir: t.gpuDir, manifest: MANIFEST, appVersion: '0.3.0', probe })).usePack, true)
    assert.deepEqual(calls, [])
  } finally { t.done() }
})

test('prepareGpuStart: an app update checks the pack again', async () => {
  const t = tmp()
  try {
    installed(t)
    const { probe, calls } = probeStub({ ok: true, error: null })
    assert.equal((await gp.prepareGpuStart({ gpuDir: t.gpuDir, manifest: MANIFEST, appVersion: '0.3.1', probe })).usePack, true)
    assert.equal(calls.length, 1)
    assert.equal(t.json('pack.json').probed_for_app_version, '0.3.1')
  } finally { t.done() }
})

for (const [label, packJson, manifest] of [
  ['a pack whose check failed', { status: 'error', error: 'boom' }, MANIFEST],
  ['a pack for another PyTorch', {}, { ...MANIFEST, torch: '2.9.0+cu128' }],
]) {
  test(`prepareGpuStart: ${label} is not used and not checked`, async () => {
    const t = tmp()
    try {
      installed(t, packJson)
      const before = fs.readFileSync(t.p('pack.json'), 'utf8')
      const { probe, calls } = probeStub({ ok: true })
      assert.equal((await gp.prepareGpuStart({ gpuDir: t.gpuDir, manifest, appVersion: '0.3.0', probe })).usePack, false)
      assert.deepEqual(calls, [])
      assert.equal(fs.readFileSync(t.p('pack.json'), 'utf8'), before)
    } finally { t.done() }
  })
}

test('prepareGpuStart: a removal is applied and nothing is used', async () => {
  const t = tmp()
  try {
    installed(t)
    t.write('remove')
    const out = await gp.prepareGpuStart({ gpuDir: t.gpuDir, manifest: MANIFEST, appVersion: '0.3.0', probe: async () => ({ ok: true }) })
    assert.deepEqual(out, { usePack: false, applied: 'removed', probe: null })
  } finally { t.done() }
})

test('markPackError: a backend that did not start with the pack', () => {
  const t = tmp()
  try {
    installed(t)
    gp.markPackError(t.gpuDir, 'The backend did not start with GPU acceleration')
    assert.deepEqual(t.json('pack.json'), {
      torch: '2.8.0+cu128', status: 'error', error: 'The backend did not start with GPU acceleration',
      probed_for_app_version: '0.3.0',
    })
  } finally { t.done() }
})

// ── environment ───────────────────────────────────────────────────────────────

test('gpuBackendEnv: the backend learns the folder and manifest; the pack goes first on PYTHONPATH', () => {
  const env = gp.gpuBackendEnv({ gpuDir: '/data/gpu', manifestPath: '/res/gpu-manifest.json', usePack: true })
  assert.deepEqual(env, {
    SONORUS_GPU_DIR: '/data/gpu',
    SONORUS_GPU_MANIFEST: '/res/gpu-manifest.json',
    PYTHONPATH: path.join('/data/gpu', 'pack'),
  })
  assert.deepEqual(gp.gpuBackendEnv({ gpuDir: '/data/gpu', manifestPath: '/res/gpu-manifest.json', usePack: false }), {
    SONORUS_GPU_DIR: '/data/gpu',
    SONORUS_GPU_MANIFEST: '/res/gpu-manifest.json',
  })
})

test('gpuSupported: packaged Linux / Windows with a manifest only', () => {
  const t = tmp()
  try {
    const manifest = path.join(t.gpuDir, 'gpu-manifest.json')
    assert.equal(gp.gpuSupported({ isPackaged: true, platform: 'linux', manifestPath: manifest }), false)
    t.write('gpu-manifest.json', '{}')
    assert.equal(gp.gpuSupported({ isPackaged: true, platform: 'linux', manifestPath: manifest }), true)
    assert.equal(gp.gpuSupported({ isPackaged: true, platform: 'win32', manifestPath: manifest }), true)
    assert.equal(gp.gpuSupported({ isPackaged: true, platform: 'darwin', manifestPath: manifest }), false)
    assert.equal(gp.gpuSupported({ isPackaged: false, platform: 'linux', manifestPath: manifest }), false)
  } finally { t.done() }
})

// ── runProbe ──────────────────────────────────────────────────────────────────

const node = process.execPath

test('runProbe: the JSON line of a passing check', async () => {
  const out = await gp.runProbe(node, ['-e', 'console.log("noise"); console.log(JSON.stringify({ ok: true, torch: "2.8.0+cu128", device: "RTX", error: null }))'], {})
  assert.deepEqual(out, { ok: true, torch: '2.8.0+cu128', device: 'RTX', error: null })
})

test('runProbe: the JSON line of a failing check', async () => {
  const out = await gp.runProbe(node, ['-e', 'console.log(JSON.stringify({ ok: false, error: "CTranslate2 does not see the GPU" })); process.exit(1)'], {})
  assert.equal(out.ok, false)
  assert.equal(out.error, 'CTranslate2 does not see the GPU')
})

test('runProbe: a crash without JSON reports the exit and the last stderr line', async () => {
  const out = await gp.runProbe(node, ['-e', 'console.error("Segmentation fault"); process.exit(139)'], {})
  assert.equal(out.ok, false)
  assert.match(out.error, /exit code 139.*Segmentation fault/)
})

test('runProbe: a check that hangs is stopped', async () => {
  const out = await gp.runProbe(node, ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 300 })
  assert.equal(out.ok, false)
  assert.match(out.error, /did not finish/)
})

test('runProbe: a missing interpreter', async () => {
  const out = await gp.runProbe(path.join(os.tmpdir(), 'no-such-python'), ['-m', 'app.gpu_probe'], {})
  assert.equal(out.ok, false)
  assert.match(out.error, /ENOENT/)
})
