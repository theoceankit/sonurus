const { app } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')

let proc = null

function getPythonExe() {
  const isWin = process.platform === 'win32'
  if (app.isPackaged) {
    const bin = isWin ? 'python.exe' : 'python3'
    const sub = isWin ? 'Scripts' : 'bin'
    return path.join(process.resourcesPath, 'backend', 'python-dist', sub, bin)
  }
  const bin = isWin ? 'python.exe' : 'python3'
  const sub = isWin ? 'Scripts' : 'bin'
  return path.join(__dirname, '..', '.venv', sub, bin)
}

function getWorkDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, '..')
}

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

async function startBackend(hfToken = '') {
  // Skip if a server is already running (e.g. manual dev server)
  if (await checkHealth()) return

  const userData = app.getPath('userData')
  const env = {
    ...process.env,
    HF_TOKEN: hfToken,
    SONORUS_DATA_DIR: userData,
    LOG_FILE: path.join(userData, 'sonorus.log'),
    PYTHONUNBUFFERED: '1',
    VERBOSE: 'false',
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
}

function stopBackend() {
  if (proc) {
    proc.kill()
    proc = null
  }
}

module.exports = { startBackend, stopBackend }
