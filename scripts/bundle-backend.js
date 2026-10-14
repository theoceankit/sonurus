#!/usr/bin/env node
'use strict'

// Assembles backend-dist/ so electron-builder can include it as extraResources:
// python-build-standalone with every backend library installed from the
// platform's lock file (locks/packaged-<platform>-<arch>.txt), app/ sources,
// all Python code precompiled, and ffmpeg. The packaged app installs nothing.
//
// Run before building:  node scripts/bundle-backend.js
// Or via npm:           npm run bundle-backend
//
// The Python tarball is cached in backend-dist/; python-dist/ is re-extracted
// on every run so libraries from an older lock never linger. Lock files are
// regenerated with scripts/lock-backend.js.

const fs            = require('fs')
const path          = require('path')
const { spawnSync } = require('child_process')

const PYTHON_VERSION = '3.12.10'
const RELEASE_DATE   = '20250517'

// Platforms the installers are built for (.github/workflows/build.yml).
const FILENAME = {
  'darwin-arm64': `cpython-${PYTHON_VERSION}+${RELEASE_DATE}-aarch64-apple-darwin-install_only.tar.gz`,
  'win32-x64':    `cpython-${PYTHON_VERSION}+${RELEASE_DATE}-x86_64-pc-windows-msvc-install_only.tar.gz`,
  'linux-x64':    `cpython-${PYTHON_VERSION}+${RELEASE_DATE}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
}
const BUILD_TARGETS = Object.keys(FILENAME)

const BASE_URL = `https://github.com/indygreg/python-build-standalone/releases/download/${RELEASE_DATE}/`

const ROOT    = path.resolve(__dirname, '..')
const DEST    = path.join(ROOT, 'backend-dist')
const PY_DIST = path.join(DEST, 'python-dist')

function lockPath(key) {
  return path.join(ROOT, 'locks', `packaged-${key}.txt`)
}

// Microsoft Visual C++ 2015–2022 runtime (x64), which the Windows wheels
// (torch, ctranslate2, onnxruntime, …) link against. python-build-standalone
// ships only vcruntime140*.dll and a clean Windows has no msvcp140.dll, so the
// Windows build copies the whole set from the build machine next to python.exe
// (app-local deployment; the vcruntime140*.dll from the archive are replaced
// so the C runtime is never older than the C++ library).
const VC_RUNTIME_DLLS = [
  'msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll',
  'msvcp140_atomic_wait.dll', 'msvcp140_codecvt_ids.dll',
  'vcruntime140.dll', 'vcruntime140_1.dll',
  'concrt140.dll', 'vcomp140.dll',
]

function copyVcRuntime(pyDist, systemDir) {
  const missing = VC_RUNTIME_DLLS.filter(name => !fs.existsSync(path.join(systemDir, name)))
  if (missing.length) {
    throw new Error(`Missing in ${systemDir}: ${missing.join(', ')}. ` +
      'Install the Microsoft Visual C++ Redistributable (x64) on the build machine: ' +
      'https://aka.ms/vs/17/release/vc_redist.x64.exe')
  }
  for (const name of VC_RUNTIME_DLLS) fs.copyFileSync(path.join(systemDir, name), path.join(pyDist, name))
}

// Layout of an extracted python-build-standalone install_only archive.
function pythonLayout(pyDist, platform = process.platform) {
  return platform === 'win32'
    ? { exe: path.join(pyDist, 'python.exe'),      lib: path.join(pyDist, 'Lib') }
    : { exe: path.join(pyDist, 'bin', 'python3'),  lib: path.join(pyDist, 'lib', `python${PYTHON_VERSION.split('.').slice(0, 2).join('.')}`) }
}

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

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' })
  if (res.error) throw res.error
  return res.status
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const tar       = require('tar')
  const ffmpegSrc = require('ffmpeg-static')

  const key      = `${process.platform}-${process.arch}`
  const filename = FILENAME[key]
  if (!filename) {
    console.error(`Unsupported platform: ${key}`)
    console.error(`Supported: ${BUILD_TARGETS.join(', ')}`)
    process.exit(1)
  }
  const lock = lockPath(key)
  if (!fs.existsSync(lock)) {
    console.error(`No lock file for ${key}: ${path.relative(ROOT, lock)} (run node scripts/lock-backend.js)`)
    process.exit(1)
  }

  fs.mkdirSync(DEST, { recursive: true })

  // ── Python interpreter (tarball cached, always re-extracted) ─────────────
  const tarball = path.join(DEST, filename)

  if (!fs.existsSync(tarball)) {
    console.log(`Downloading ${filename}…`)
    await download(BASE_URL + filename, tarball)
    console.log('Download complete.')
  } else {
    console.log('Tarball cached, skipping download.')
  }

  console.log('Extracting Python…')
  fs.rmSync(PY_DIST, { recursive: true, force: true })
  fs.mkdirSync(PY_DIST, { recursive: true })
  await tar.x({ file: tarball, cwd: PY_DIST, strip: 1 })

  const { exe, lib } = pythonLayout(PY_DIST)

  if (process.platform === 'win32') {
    console.log('Copying the Visual C++ runtime…')
    copyVcRuntime(PY_DIST, path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'))
  }

  // ── Libraries from the lock file ─────────────────────────────────────────
  console.log(`Installing libraries from ${path.relative(ROOT, lock)}…`)
  const pipStatus = run(exe, [
    '-m', 'pip', 'install',
    '--no-deps', '--require-hashes', '--only-binary=:all:',
    '--no-compile', '--no-warn-script-location', '--disable-pip-version-check',
    '-r', lock,
  ])
  if (pipStatus !== 0) throw new Error(`pip install exited with code ${pipStatus}`)

  // ── App source (always refreshed) ────────────────────────────────────────
  console.log('Copying app source…')
  fs.rmSync(path.join(DEST, 'app'), { recursive: true, force: true })
  copyDir(path.join(ROOT, 'app'), path.join(DEST, 'app'), ['__pycache__'])

  // ── Precompile ───────────────────────────────────────────────────────────
  // unchecked-hash .pyc are never revalidated against source mtimes, so they
  // are used as is inside the read-only AppImage / .app and after NSIS copies
  // the files. Libraries and app/ must compile cleanly; the stdlib carries a
  // few files that never compile (e.g. Tix demo scripts), so only warn there.
  console.log('Precompiling Python code…')
  const compile = dirs => run(exe, ['-m', 'compileall', '-q', '-j', '0', '--invalidation-mode', 'unchecked-hash', ...dirs])
  const sitePackages = path.join(lib, 'site-packages')
  if (compile([sitePackages, path.join(DEST, 'app')]) !== 0) {
    throw new Error('compileall failed for site-packages or app/')
  }
  if (compile(['-x', '[\\\\/]site-packages[\\\\/]', lib]) !== 0) {
    console.warn('Some standard library files did not compile (ignored).')
  }

  // ── ffmpeg binary ─────────────────────────────────────────────────────────
  console.log('Copying ffmpeg…')
  const binDir   = path.join(DEST, 'bin')
  const ffmpegDst = path.join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  fs.mkdirSync(binDir, { recursive: true })
  fs.copyFileSync(ffmpegSrc, ffmpegDst)
  fs.chmodSync(ffmpegDst, 0o755)

  console.log('backend-dist ready.')
}

module.exports = { BUILD_TARGETS, VC_RUNTIME_DLLS, copyVcRuntime, lockPath, pythonLayout }

if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1) })
}
