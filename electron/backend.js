const { app } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const fs   = require('fs')

let proc = null

// ── paths ─────────────────────────────────────────────────────────────────────

function getPythonExe() {
  const isWin = process.platform === 'win32'
  const bin   = isWin ? 'python.exe' : 'python3'
  const sub   = isWin ? 'Scripts'    : 'bin'
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend', 'python-dist', sub, bin)
  }
  return path.join(__dirname, '..', '.venv', sub, bin)
}

function getWorkDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, '..')
}

function getPkgDir() {
  return path.join(app.getPath('userData'), 'python-packages')
}

function getReqFile() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'requirements.txt')
    : path.join(__dirname, '..', 'requirements.packaged.txt')
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

// ── setup (first-run pip install) ─────────────────────────────────────────────

function needsSetup() {
  if (!app.isPackaged) return false
  return !fs.existsSync(path.join(getPkgDir(), '.installed'))
}

function runSetup(onProgress) {
  const pkgDir = getPkgDir()
  fs.mkdirSync(pkgDir, { recursive: true })

  return new Promise((resolve, reject) => {
    const pip = spawn(
      getPythonExe(),
      ['-m', 'pip', 'install', '-r', getReqFile(),
       '--target', pkgDir, '--no-warn-script-location'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )

    function relay(chunk) {
      chunk.toString().split('\n').forEach(line => {
        if (line.trim()) onProgress({ type: 'log', line })
      })
    }

    pip.stdout.on('data', relay)
    pip.stderr.on('data', relay)

    pip.on('exit', code => {
      if (code === 0) {
        fs.writeFileSync(path.join(pkgDir, '.installed'), new Date().toISOString())
        resolve()
      } else {
        reject(new Error(`pip exited with code ${code}`))
      }
    })
  })
}

// ── public API ────────────────────────────────────────────────────────────────

async function startBackend(hfToken = '', onProgress = null) {
  if (await checkHealth()) return

  if (needsSetup()) {
    const cb = onProgress || (() => {})
    cb({ type: 'status', message: 'Installing dependencies…' })
    await runSetup(cb)
    cb({ type: 'status', message: 'Starting backend…' })
  }

  const userData = app.getPath('userData')
  const env = {
    ...process.env,
    HF_TOKEN: hfToken,
    SONORUS_DATA_DIR: userData,
    LOG_FILE: path.join(userData, 'sonorus.log'),
    PYTHONUNBUFFERED: '1',
    VERBOSE: 'false',
  }

  if (app.isPackaged) {
    const existing = env.PYTHONPATH ? `${getPkgDir()}${path.delimiter}${env.PYTHONPATH}` : getPkgDir()
    env.PYTHONPATH = existing
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
  if (proc) { proc.kill(); proc = null }
}

module.exports = { startBackend, stopBackend, needsSetup }
