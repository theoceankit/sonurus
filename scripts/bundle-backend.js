#!/usr/bin/env node
'use strict'

// Downloads python-build-standalone for the current platform and assembles
// backend-dist/ so electron-builder can include it as extraResources.
//
// Run before building:  node scripts/bundle-backend.js
// Or via npm:           npm run bundle-backend
//
// Python and its tarball are cached in backend-dist/ and reused on
// subsequent runs. Pass --force to re-extract Python (e.g. after a
// version bump).

const fs   = require('fs')
const path = require('path')
const tar  = require('tar')

const PYTHON_VERSION = '3.12.10'
const RELEASE_DATE   = '20250517'

const FILENAME = {
  'darwin-arm64': `cpython-${PYTHON_VERSION}+${RELEASE_DATE}-aarch64-apple-darwin-install_only.tar.gz`,
  'darwin-x64':   `cpython-${PYTHON_VERSION}+${RELEASE_DATE}-x86_64-apple-darwin-install_only.tar.gz`,
  'win32-x64':    `cpython-${PYTHON_VERSION}+${RELEASE_DATE}-x86_64-pc-windows-msvc-install_only.tar.gz`,
  'linux-x64':    `cpython-${PYTHON_VERSION}+${RELEASE_DATE}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
  'linux-arm64':  `cpython-${PYTHON_VERSION}+${RELEASE_DATE}-aarch64-unknown-linux-gnu-install_only.tar.gz`,
}

const BASE_URL = `https://github.com/indygreg/python-build-standalone/releases/download/${RELEASE_DATE}/`

const ROOT    = path.resolve(__dirname, '..')
const DEST    = path.join(ROOT, 'backend-dist')
const PY_DIST = path.join(DEST, 'python-dist')
const FORCE   = process.argv.includes('--force')

// ── helpers ───────────────────────────────────────────────────────────────────

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`)
  const buf = await res.arrayBuffer()
  fs.writeFileSync(dest, Buffer.from(buf))
}

function copyDir(src, dst, exclude = []) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclude.includes(entry.name)) continue
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) copyDir(s, d, exclude)
    else fs.copyFileSync(s, d)
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const key      = `${process.platform}-${process.arch}`
  const filename = FILENAME[key]
  if (!filename) {
    console.error(`Unsupported platform: ${key}`)
    console.error(`Supported: ${Object.keys(FILENAME).join(', ')}`)
    process.exit(1)
  }

  fs.mkdirSync(DEST, { recursive: true })

  // ── Python interpreter (cached) ───────────────────────────────────────────
  const tarball = path.join(DEST, filename)

  if (!fs.existsSync(tarball)) {
    console.log(`Downloading ${filename}…`)
    await download(BASE_URL + filename, tarball)
    console.log('Download complete.')
  } else {
    console.log('Tarball cached, skipping download.')
  }

  if (FORCE || !fs.existsSync(PY_DIST)) {
    console.log('Extracting Python…')
    if (fs.existsSync(PY_DIST)) fs.rmSync(PY_DIST, { recursive: true })
    fs.mkdirSync(PY_DIST, { recursive: true })
    await tar.x({ file: tarball, cwd: PY_DIST, strip: 1 })
  } else {
    console.log('python-dist cached, skipping extraction.')
  }

  // ── App source (always refreshed) ────────────────────────────────────────
  console.log('Copying app source…')
  copyDir(path.join(ROOT, 'app'), path.join(DEST, 'app'), ['__pycache__'])

  // macOS PyPI wheels are already CPU-only (no CUDA). The +cpu suffix and
  // the PyTorch whl extra-index-url only exist for Linux/Windows builds.
  let reqContent = fs.readFileSync(path.join(ROOT, 'requirements.packaged.txt'), 'utf8')
  if (process.platform === 'darwin') {
    reqContent = reqContent
      .split('\n')
      .filter(line => !line.startsWith('--extra-index-url'))
      .map(line => line.replace(/\+cpu\b/g, ''))
      .join('\n')
  }
  fs.writeFileSync(path.join(DEST, 'requirements.txt'), reqContent)

  console.log('backend-dist ready.')
}

main().catch(err => { console.error(err.message); process.exit(1) })
