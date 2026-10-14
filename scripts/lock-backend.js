#!/usr/bin/env node
'use strict'

// Regenerates locks/packaged-<platform>-<arch>.txt from requirements.packaged.txt:
// every library of the packaged backend (direct and transitive) pinned with
// hashes, once per installer platform. scripts/bundle-backend.js installs
// exactly these files, so the same app version always ships the same libraries.
//
// For the platforms with GPU acceleration (Linux, Windows) it also writes
// locks/gpu-<platform>-<arch>.json: the packages the app downloads to run on an
// NVIDIA GPU — the cu128 builds of the torch family plus the CUDA libraries —
// with wheel URL, sha256 and size. They are resolved with every other package
// pinned to the CPU lock, so the download only replaces or adds CUDA packages.
//
// Needs uv (https://docs.astral.sh/uv/) on PATH, or its path in $UV:
//   node scripts/lock-backend.js
//
// Run it after every change to requirements.packaged.txt and commit the locks.

const fs            = require('fs')
const os            = require('os')
const path          = require('path')
const { spawnSync } = require('child_process')
const { BUILD_TARGETS, GPU_TARGETS, lockPath, gpuManifestPath } = require('./bundle-backend')

const ROOT = path.resolve(__dirname, '..')
const REQS = 'requirements.packaged.txt'

// uv target per build platform. macOS: PyPI wheels are CPU-only and carry no
// +cpu suffix, so the PyTorch CPU index is dropped; onnxruntime ships macOS 14+
// wheels only, which sets the minimum macOS of the packaged app.
const TARGETS = {
  'linux-x64':    { platform: 'x86_64-unknown-linux-gnu' },
  'win32-x64':    { platform: 'x86_64-pc-windows-msvc' },
  'darwin-arm64': { platform: 'aarch64-apple-darwin', macosTarget: '14.0', pypiOnly: true },
}

// The GPU build: CUDA 12.8 needs an NVIDIA driver 570 or newer; the cu128
// wheels of torch 2.8 have no kernels for GPUs older than Volta (7.0).
const GPU_BUILD = { tag: 'cu128', cuda: '12.8', minDriver: '570', minComputeCapability: '7.0' }

// Packages whose CUDA build differs from the CPU lock; everything else is
// pinned to the CPU lock while resolving the GPU set.
const CUDA_FAMILY = new Set(['torch', 'torchaudio', 'torchvision', 'torchcodec', 'triton'])
const isCudaPackage = name => CUDA_FAMILY.has(name) || /^nvidia-[a-z0-9-]+$/.test(name)

// Wheel platform tags per build platform.
const WHEEL_PLATFORM = {
  'linux-x64': tag => /^(manylinux\w*_x86_64|linux_x86_64)$/.test(tag),
  'win32-x64': tag => tag === 'win_amd64',
}
const PYTHON_TAG = /^(cp312|py3|py312|py2\.py3)$/

const normName = name => name.toLowerCase().replace(/[_.]+/g, '-')

function inputFor(target, text) {
  if (!target.pypiOnly) return text
  return text
    .split('\n')
    .filter(line => !line.startsWith('--extra-index-url'))
    .map(line => line.replace(/\+cpu\b/g, ''))
    .join('\n')
}

// ── GPU manifest helpers ──────────────────────────────────────────────────────

// requirements.packaged.txt switched from the CPU to the CUDA build of PyTorch
function gpuRequirements(text) {
  return text
    .replace(/download\.pytorch\.org\/whl\/cpu\b/g, `download.pytorch.org/whl/${GPU_BUILD.tag}`)
    .replace(/\+cpu\b/g, `+${GPU_BUILD.tag}`)
}

// { name → version } from a uv/pip-compile lock file
function parseLockPins(text) {
  const pins = {}
  for (const raw of text.split('\n')) {
    const pin = raw.trim().match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?==([^\s\\;]+)/)
    if (pin) pins[normName(pin[1])] = pin[2]
  }
  return pins
}

// uv constraints file: every CPU lock package except the CUDA family
function gpuConstraints(lockText) {
  return Object.entries(parseLockPins(lockText))
    .filter(([name]) => !isCudaPackage(name))
    .map(([name, version]) => `${name}==${version}\n`)
    .join('')
}

// [{ name, version, wheels: [{ url, sha256, size|null }] }] from uv's pylock.toml.
// uv writes every wheel as a one-line inline table, so a line-based read is enough.
function parsePylock(text) {
  const pkgs = []
  let current = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '[[packages]]') { current = { name: null, version: null, wheels: [] }; pkgs.push(current); continue }
    if (!current) continue
    const field = line.match(/^(name|version) = "([^"]+)"$/)
    if (field) { current[field[1]] = field[1] === 'name' ? normName(field[2]) : field[2]; continue }
    if (line.startsWith('sdist')) continue
    const url = line.match(/url = "([^"]+\.whl)"/)
    if (!url) continue
    const sha = line.match(/sha256 = "([0-9a-f]{64})"/)
    if (!sha) throw new Error(`wheel without sha256 in pylock: ${url[1]}`)
    const size = line.match(/\bsize = (\d+)/)
    current.wheels.push({ url: url[1], sha256: sha[1], size: size ? Number(size[1]) : null })
  }
  return pkgs
}

// The package's wheel for a build platform: platform-specific before pure-Python.
function pickWheel(pkg, key) {
  const platformOk = WHEEL_PLATFORM[key]
  const tagsOf = url => {
    const parts = decodeURIComponent(url.split('/').pop()).replace(/\.whl$/, '').split('-')
    return { python: parts.at(-3).split('.'), platform: parts.at(-1).split('.') }
  }
  const usable = pkg.wheels.filter(w => tagsOf(w.url).python.some(t => PYTHON_TAG.test(t)))
  const wheel = usable.find(w => tagsOf(w.url).platform.some(platformOk))
            ?? usable.find(w => tagsOf(w.url).platform.includes('any'))
  if (!wheel) throw new Error(`no wheel of ${pkg.name} ${pkg.version} for ${key}`)
  return wheel
}

async function headSizeOf(url) {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' })
  const size = Number(res.headers.get('content-length'))
  if (!res.ok || !(size > 0)) throw new Error(`HEAD ${url}: HTTP ${res.status}, no size`)
  return size
}

// The GPU manifest of one platform from the resolved CUDA set and the CPU lock.
async function buildGpuManifest({ key, pylockText, cpuPins, headSize = headSizeOf }) {
  const packages = []
  for (const pkg of parsePylock(pylockText)) {
    if (cpuPins[pkg.name] === pkg.version) continue
    if (!isCudaPackage(pkg.name)) {
      throw new Error(`${pkg.name} ${pkg.version} differs from the CPU lock (${cpuPins[pkg.name] ?? 'absent'})`)
    }
    const wheel = pickWheel(pkg, key)
    packages.push({
      name: pkg.name,
      version: pkg.version,
      url: wheel.url,
      sha256: wheel.sha256,
      size: wheel.size ?? await headSize(wheel.url),
    })
  }
  packages.sort((a, b) => a.name.localeCompare(b.name))
  const torch = packages.find(p => p.name === 'torch')
  if (!torch) throw new Error(`no torch in the ${key} GPU set`)
  return {
    platform: key,
    torch: torch.version,
    base_torch: torch.version.replace(new RegExp(`\\+${GPU_BUILD.tag}$`), ''),
    cuda: GPU_BUILD.cuda,
    min_driver: GPU_BUILD.minDriver,
    min_compute_capability: GPU_BUILD.minComputeCapability,
    total_size: packages.reduce((sum, p) => sum + p.size, 0),
    packages,
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

function uvCompile(uv, args, { cwd, env }) {
  const res = spawnSync(uv, ['pip', 'compile', ...args], { cwd, env, stdio: 'inherit' })
  if (res.error) throw new Error(`Cannot run ${uv}: ${res.error.message} (install uv or set $UV)`)
  return res.status
}

async function main() {
  const uv = process.env.UV || 'uv'
  const reqText = fs.readFileSync(path.join(ROOT, REQS), 'utf8')
  // uv runs in a temp dir holding a (possibly rewritten) copy named like the
  // original, so "# via -r requirements.packaged.txt" annotations stay stable.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-lock-'))
  fs.mkdirSync(path.join(ROOT, 'locks'), { recursive: true })

  try {
    for (const key of BUILD_TARGETS) {
      const target = TARGETS[key]
      if (!target) throw new Error(`No uv target for build platform ${key}`)
      fs.writeFileSync(path.join(tmp, REQS), inputFor(target, reqText))

      const out = lockPath(key)
      console.log(`Locking ${key} → ${path.relative(ROOT, out)}`)
      const env = { ...process.env }
      if (target.macosTarget) env.MACOSX_DEPLOYMENT_TARGET = target.macosTarget
      const status = uvCompile(uv, [
        REQS,
        '--python-version', '3.12',
        '--python-platform', target.platform,
        '--generate-hashes',
        '--emit-index-url',
        '--index-strategy', 'unsafe-best-match',
        '--no-header',
        '--quiet',
        '--output-file', out,
      ], { cwd: tmp, env })
      if (status !== 0) throw new Error(`uv pip compile failed for ${key}`)

      if (!GPU_TARGETS.includes(key)) continue

      const manifestOut = gpuManifestPath(key)
      console.log(`Resolving the GPU set for ${key} → ${path.relative(ROOT, manifestOut)}`)
      const lockText = fs.readFileSync(out, 'utf8')
      fs.writeFileSync(path.join(tmp, REQS), gpuRequirements(reqText))
      fs.writeFileSync(path.join(tmp, 'constraints.txt'), gpuConstraints(lockText))
      const pylock = path.join(tmp, 'pylock.gpu.toml')
      const gpuStatus = uvCompile(uv, [
        REQS,
        '--constraint', 'constraints.txt',
        '--python-version', '3.12',
        '--python-platform', target.platform,
        '--index-strategy', 'unsafe-best-match',
        '--format', 'pylock.toml',
        '--quiet',
        '--output-file', pylock,
      ], { cwd: tmp, env })
      if (gpuStatus !== 0) throw new Error(`uv pip compile (GPU) failed for ${key}`)

      const manifest = await buildGpuManifest({
        key,
        pylockText: fs.readFileSync(pylock, 'utf8'),
        cpuPins: parseLockPins(lockText),
      })
      fs.writeFileSync(manifestOut, JSON.stringify(manifest, null, 2) + '\n')
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  console.log('Locks updated.')
}

module.exports = { buildGpuManifest, gpuConstraints, gpuRequirements, parseLockPins, parsePylock, pickWheel }

if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1) })
}
