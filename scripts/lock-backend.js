#!/usr/bin/env node
'use strict'

// Regenerates locks/packaged-<platform>-<arch>.txt from requirements.packaged.txt:
// every library of the packaged backend (direct and transitive) pinned with
// hashes, once per installer platform. scripts/bundle-backend.js installs
// exactly these files, so the same app version always ships the same libraries.
//
// Needs uv (https://docs.astral.sh/uv/) on PATH, or its path in $UV:
//   node scripts/lock-backend.js
//
// Run it after every change to requirements.packaged.txt and commit the locks.

const fs            = require('fs')
const os            = require('os')
const path          = require('path')
const { spawnSync } = require('child_process')
const { BUILD_TARGETS, lockPath } = require('./bundle-backend')

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

function inputFor(target, text) {
  if (!target.pypiOnly) return text
  return text
    .split('\n')
    .filter(line => !line.startsWith('--extra-index-url'))
    .map(line => line.replace(/\+cpu\b/g, ''))
    .join('\n')
}

function main() {
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
      const res = spawnSync(uv, [
        'pip', 'compile', REQS,
        '--python-version', '3.12',
        '--python-platform', target.platform,
        '--generate-hashes',
        '--emit-index-url',
        '--index-strategy', 'unsafe-best-match',
        '--no-header',
        '--quiet',
        '--output-file', out,
      ], { cwd: tmp, env, stdio: 'inherit' })
      if (res.error) throw new Error(`Cannot run ${uv}: ${res.error.message} (install uv or set $UV)`)
      if (res.status !== 0) throw new Error(`uv pip compile failed for ${key}`)
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  console.log('Locks updated.')
}

try { main() } catch (err) { console.error(err.message); process.exit(1) }
