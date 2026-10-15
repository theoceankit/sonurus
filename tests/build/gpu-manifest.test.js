'use strict'

// GPU acceleration is an optional in-app download of the CUDA build of PyTorch
// (Linux and Windows). scripts/lock-backend.js writes one manifest per platform,
// locks/gpu-<platform>.json: only the packages that replace or add to the CPU
// lock, each with its wheel URL, sha256 and size. These tests guard the
// manifests and the helpers that build them.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const os     = require('os')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const bundle = require(path.join(ROOT, 'scripts', 'bundle-backend.js'))
const lock   = require(path.join(ROOT, 'scripts', 'lock-backend.js'))
const { BUILD_TARGETS, GPU_TARGETS, lockPath, gpuManifestPath } = bundle

// Packages a CUDA build may bring in; anything else means the GPU resolution
// drifted away from the CPU lock (it is constrained by it).
const GPU_PACKAGE = /^(torch|torchaudio|torchvision|torchcodec|triton|nvidia-[a-z0-9-]+)$/

const readManifest = key => JSON.parse(fs.readFileSync(gpuManifestPath(key), 'utf8'))
const cpuLock      = key => lock.parseLockPins(fs.readFileSync(lockPath(key), 'utf8'))

// ── committed manifests ────────────────────────────────────────────────────────

test('GPU manifests exist for Linux and Windows only', () => {
  assert.deepEqual([...GPU_TARGETS].sort(), ['linux-x64', 'win32-x64'])
  for (const key of BUILD_TARGETS) {
    const file = gpuManifestPath(key)
    assert.equal(fs.existsSync(file), GPU_TARGETS.includes(key), path.relative(ROOT, file))
  }
})

for (const key of ['linux-x64', 'win32-x64']) {
  test(`${key} GPU manifest is the cu128 build of the bundled torch`, () => {
    const m = readManifest(key)
    const cpu = cpuLock(key)
    assert.equal(m.platform, key)
    assert.equal(m.cuda, '12.8')
    assert.equal(m.min_driver, '570')
    assert.equal(m.min_compute_capability, '7.0')
    assert.equal(m.base_torch, cpu.torch.replace(/\+cpu$/, ''), 'regenerate locks: torch changed')
    assert.equal(m.torch, `${m.base_torch}+cu128`)
    const byName = Object.fromEntries(m.packages.map(p => [p.name, p]))
    for (const name of ['torch', 'torchaudio', 'torchvision']) {
      assert.ok(byName[name], `${name} missing`)
      assert.match(byName[name].version, /\+cu128$/, `${name} must be the cu128 build`)
      // torchvision is left out of the installer, so it has no bundled version
      if (name === 'torchvision') continue
      assert.equal(byName[name].version.replace(/\+cu128$/, ''), cpu[name].replace(/\+cpu$/, ''),
        `${name} must match the bundled version`)
    }
  })

  test(`${key} GPU manifest only replaces or adds CUDA packages`, () => {
    const m = readManifest(key)
    const cpu = cpuLock(key)
    for (const p of m.packages) {
      assert.match(p.name, GPU_PACKAGE, `${p.name} does not belong in the GPU pack`)
      assert.notEqual(cpu[p.name], p.version, `${p.name} ${p.version} is already in the CPU lock`)
    }
    // every +cpu build of the CPU lock is replaced
    for (const [name, version] of Object.entries(cpu)) {
      if (version.endsWith('+cpu')) assert.ok(m.packages.some(p => p.name === name), `${name} not replaced`)
    }
  })

  test(`${key} GPU manifest pins every wheel by URL, sha256 and size`, () => {
    const m = readManifest(key)
    let total = 0
    for (const p of m.packages) {
      assert.match(p.url, /^https:\/\/[^\s]+\.whl$/, `${p.name} url`)
      assert.match(p.sha256, /^[0-9a-f]{64}$/, `${p.name} sha256`)
      assert.ok(Number.isInteger(p.size) && p.size > 0, `${p.name} size`)
      total += p.size
    }
    assert.equal(m.total_size, total)
    const names = m.packages.map(p => p.name)
    assert.deepEqual(names, [...names].sort(), 'packages sorted by name')
  })
}

// ── helpers ────────────────────────────────────────────────────────────────────

test('gpuRequirements switches the CPU requirements to cu128', () => {
  const text = [
    '--extra-index-url https://download.pytorch.org/whl/cpu',
    'torch==2.8.0+cpu',
    'torchaudio==2.8.0+cpu',
    'whisperx==3.8.5',
  ].join('\n')
  assert.equal(lock.gpuRequirements(text), [
    '--extra-index-url https://download.pytorch.org/whl/cu128',
    'torch==2.8.0+cu128',
    'torchaudio==2.8.0+cu128',
    'whisperx==3.8.5',
  ].join('\n'))
})

test('gpuConstraints pins every CPU lock package except the CUDA ones', () => {
  const lockText = [
    '--extra-index-url https://download.pytorch.org/whl/cpu',
    'starlette==1.7.0 \\',
    '    --hash=sha256:' + 'a'.repeat(64),
    '    # via fastapi',
    'torch==2.8.0+cpu \\',
    '    --hash=sha256:' + 'b'.repeat(64),
    'torchcodec==0.7.0 \\',
    '    --hash=sha256:' + 'c'.repeat(64),
    'triton==3.8.0 \\',
    '    --hash=sha256:' + 'd'.repeat(64),
    'uvicorn[standard]==0.46.0 \\',
    '    --hash=sha256:' + 'e'.repeat(64),
  ].join('\n')
  assert.equal(lock.gpuConstraints(lockText), 'starlette==1.7.0\nuvicorn==0.46.0\n')
})

const PYLOCK = `# generated by uv
lock-version = "1.0"
created-by = "uv"

[[packages]]
name = "fonttools"
version = "4.66.1"
sdist = { url = "https://files.example/fonttools-4.66.1.tar.gz", size = 3694174, hashes = { sha256 = "${'0'.repeat(64)}" } }
wheels = [
    { url = "https://files.example/fonttools-4.66.1-cp312-cp312-manylinux2014_x86_64.whl", upload-time = 2026-09-29T16:10:14Z, size = 5397326, hashes = { sha256 = "${'1'.repeat(64)}" } },
    { url = "https://files.example/fonttools-4.66.1-cp312-cp312-win_amd64.whl", size = 2300000, hashes = { sha256 = "${'2'.repeat(64)}" } },
    { url = "https://files.example/fonttools-4.66.1-py3-none-any.whl", size = 1100000, hashes = { sha256 = "${'3'.repeat(64)}" } },
]

[[packages]]
name = "nvidia-cudnn-cu12"
version = "9.10.2.21"
marker = "platform_machine == 'x86_64' and sys_platform == 'linux'"
wheels = [{ url = "https://pypi.nvidia.com/nvidia-cudnn-cu12/nvidia_cudnn_cu12-9.10.2.21-py3-none-manylinux_2_27_x86_64.whl", hashes = { sha256 = "${'4'.repeat(64)}" } }]

[[packages]]
name = "torch"
version = "2.8.0+cu128"
wheels = [{ url = "https://download-r2.pytorch.org/whl/cu128/torch-2.8.0%2Bcu128-cp312-cp312-manylinux_2_28_x86_64.whl", upload-time = 2025-10-01T23:51:02Z, hashes = { sha256 = "${'5'.repeat(64)}" } }]

[[packages]]
name = "Typing_Extensions"
version = "4.15.0"
wheels = [{ url = "https://files.example/typing_extensions-4.15.0-py3-none-any.whl", size = 44614, hashes = { sha256 = "${'6'.repeat(64)}" } }]
`

test('parsePylock reads name, version and every wheel of uv output', () => {
  const pkgs = lock.parsePylock(PYLOCK)
  assert.deepEqual(pkgs.map(p => [p.name, p.version, p.wheels.length]), [
    ['fonttools', '4.66.1', 3],
    ['nvidia-cudnn-cu12', '9.10.2.21', 1],
    ['torch', '2.8.0+cu128', 1],
    ['typing-extensions', '4.15.0', 1],
  ])
  assert.deepEqual(pkgs[0].wheels[0], {
    url: 'https://files.example/fonttools-4.66.1-cp312-cp312-manylinux2014_x86_64.whl',
    sha256: '1'.repeat(64),
    size: 5397326,
  })
  assert.equal(pkgs[2].wheels[0].size, null, 'size unknown when uv does not write it')
})

test('pickWheel takes the wheel for the platform, platform-specific first', () => {
  const [fonttools, cudnn] = lock.parsePylock(PYLOCK)
  assert.match(lock.pickWheel(fonttools, 'linux-x64').url, /manylinux2014_x86_64/)
  assert.match(lock.pickWheel(fonttools, 'win32-x64').url, /win_amd64/)
  assert.match(lock.pickWheel(cudnn, 'linux-x64').url, /nvidia_cudnn/)
  assert.throws(() => lock.pickWheel(cudnn, 'win32-x64'), /nvidia-cudnn-cu12.*win32-x64/)
})

test('buildGpuManifest keeps only packages that differ from the CPU lock', async () => {
  const cpu = { 'fonttools': '4.66.1', 'torch': '2.8.0+cpu', 'typing-extensions': '4.15.0' }
  const sizes = { 'nvidia_cudnn_cu12': 700_000_000, 'torch-2.8.0': 900_000_000 }
  const headSize = async url => {
    const hit = Object.keys(sizes).find(k => url.includes(k))
    if (!hit) throw new Error(`unexpected HEAD ${url}`)
    return sizes[hit]
  }
  const m = await lock.buildGpuManifest({
    key: 'linux-x64', pylockText: PYLOCK, cpuPins: cpu, headSize,
  })
  assert.deepEqual(m, {
    platform: 'linux-x64',
    torch: '2.8.0+cu128',
    base_torch: '2.8.0',
    cuda: '12.8',
    min_driver: '570',
    min_compute_capability: '7.0',
    total_size: 1_600_000_000,
    packages: [
      { name: 'nvidia-cudnn-cu12', version: '9.10.2.21',
        url: 'https://pypi.nvidia.com/nvidia-cudnn-cu12/nvidia_cudnn_cu12-9.10.2.21-py3-none-manylinux_2_27_x86_64.whl',
        sha256: '4'.repeat(64), size: 700_000_000 },
      { name: 'torch', version: '2.8.0+cu128',
        url: 'https://download-r2.pytorch.org/whl/cu128/torch-2.8.0%2Bcu128-cp312-cp312-manylinux_2_28_x86_64.whl',
        sha256: '5'.repeat(64), size: 900_000_000 },
    ],
  })
})

test('buildGpuManifest refuses packages outside the CUDA set', async () => {
  const cpu = { 'fonttools': '4.60.0', 'torch': '2.8.0+cpu', 'typing-extensions': '4.15.0' }
  await assert.rejects(
    lock.buildGpuManifest({ key: 'linux-x64', pylockText: PYLOCK, cpuPins: cpu, headSize: async () => 1 }),
    /fonttools 4\.66\.1 differs from the CPU lock/,
  )
})

test('buildGpuManifest skips packages left out of the installers', async () => {
  // fonttools is excluded from the CPU lock, so the GPU resolution brings it back
  const cpu = { 'torch': '2.8.0+cpu', 'typing-extensions': '4.15.0' }
  const m = await lock.buildGpuManifest({
    key: 'linux-x64', pylockText: PYLOCK, cpuPins: cpu, headSize: async () => 1,
  })
  assert.deepEqual(m.packages.map(p => p.name), ['nvidia-cudnn-cu12', 'torch'])
})

test('buildGpuManifest refuses a package missing from the CPU lock that is not excluded', async () => {
  const cpu = { 'fonttools': '4.66.1', 'torch': '2.8.0+cpu' }
  await assert.rejects(
    lock.buildGpuManifest({ key: 'linux-x64', pylockText: PYLOCK, cpuPins: cpu, headSize: async () => 1 }),
    /typing-extensions 4\.15\.0 differs from the CPU lock \(absent\)/,
  )
})

// ── bundling ───────────────────────────────────────────────────────────────────

test('bundle ships the platform GPU manifest, and none on macOS', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-gpu-'))
  try {
    const out = path.join(dest, 'gpu-manifest.json')
    bundle.copyGpuManifest('linux-x64', dest)
    assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), readManifest('linux-x64'))
    bundle.copyGpuManifest('darwin-arm64', dest)
    assert.ok(!fs.existsSync(out), 'a stale manifest is removed')
  } finally {
    fs.rmSync(dest, { recursive: true, force: true })
  }
})
