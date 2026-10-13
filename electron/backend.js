const { app } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const fs   = require('fs')

let proc = null

// ── paths ─────────────────────────────────────────────────────────────────────

function getPythonExe() {
  const isWin = process.platform === 'win32'
  // Packaged: python-build-standalone with every library installed into it
  // at build time (scripts/bundle-backend.js). Dev: the project's .venv.
  if (app.isPackaged) {
    const pyDist = path.join(process.resourcesPath, 'backend', 'python-dist')
    return isWin ? path.join(pyDist, 'python.exe') : path.join(pyDist, 'bin', 'python3')
  }
  return isWin
    ? path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '..', '.venv', 'bin', 'python3')
}

function getWorkDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, '..')
}

// ── health check ──────────────────────────────────────────────────────────────

function checkHealth() {
  return new Promise(resolve => {
    http.get('http://127.0.0.1:8000/health', res => {
      resolve(res.statusCode === 200)
    }).on('error', () => resolve(false))
  })
}

async function waitForReady(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await checkHealth()) return
    await new Promise(r => setTimeout(r, 600))
  }
  throw new Error('Backend did not respond within 60 seconds')
}

// ── public API ────────────────────────────────────────────────────────────────

async function startBackend(hfToken = '') {
  if (await checkHealth()) return

  const startedAt = Date.now()
  const userData = app.getPath('userData')
  const env = {
    ...process.env,
    HF_TOKEN: hfToken,
    SONORUS_DATA_DIR: userData,
    LOG_FILE: path.join(userData, 'sonorus.log'),
    PYTHONUNBUFFERED: '1',
    VERBOSE: 'false',
    SONORUS_VERSION: app.getVersion(),
  }

  if (app.isPackaged) {
    // Prepend bundled ffmpeg to PATH so whisperx can find it
    const binDir = path.join(process.resourcesPath, 'backend', 'bin')
    env.PATH = `${binDir}${path.delimiter}${env.PATH || process.env.PATH || ''}`
  }

  // macOS: pass path to sonorus-capture binary (ScreenCaptureKit system audio)
  if (process.platform === 'darwin') {
    const captureBin = app.isPackaged
      ? path.join(process.resourcesPath, 'mac', 'sonorus-capture')
      : path.join(__dirname, 'resources', 'mac', 'sonorus-capture')
    if (fs.existsSync(captureBin)) {
      env.SONORUS_CAPTURE_BIN = captureBin
    }
  }

  proc = spawn(
    getPythonExe(),
    ['-m', 'uvicorn', 'app.api.main:app', '--host', '127.0.0.1', '--port', '8000'],
    { cwd: getWorkDir(), env, stdio: ['ignore', 'pipe', 'pipe'] }
  )

  proc.stdout.on('data', d => process.stdout.write(`[backend] ${d}`))
  proc.stderr.on('data', d => process.stderr.write(`[backend] ${d}`))
  proc.on('exit', () => { proc = null })

  await waitForReady()
  console.log(`[backend] ready in ${Date.now() - startedAt} ms`)
}

function stopBackend() {
  if (proc) { proc.kill(); proc = null }
}

module.exports = { startBackend, stopBackend }
