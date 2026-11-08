'use strict'

// Starts the app for an end-to-end test on data of its own: a temporary data
// directory seeded by seed.py, a backend on it (port 8000, as always) and
// Electron with a profile in the same directory. Nothing touches real data.
//
//   const app = await startApp({ seed: 'full' })
//   ... app.page is the window (Playwright Page)
//   await app.stop()

const { spawn, spawnSync } = require('child_process')
const fs   = require('fs')
const http = require('http')
const os   = require('os')
const path = require('path')
const { _electron: electron } = require('playwright')

const ROOT = path.resolve(__dirname, '..', '..')
const BACKEND = 'http://127.0.0.1:8000'
const PYTHON = process.platform === 'win32'
  ? path.join(ROOT, '.venv', 'Scripts', 'python.exe')
  : path.join(ROOT, '.venv', 'bin', 'python')
const START_TIMEOUT_MS = 60000

function health() {
  return new Promise(resolve => {
    const req = http.get(`${BACKEND}/health`, res => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => req.destroy())
  })
}

async function waitFor(check, what, timeoutMs = START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`${what} within ${timeoutMs / 1000} s`)
}

async function preflight() {
  if (!fs.existsSync(path.join(ROOT, 'ui', 'dist', 'index.html'))) {
    throw new Error('ui/dist is not built. Run: npm run build:ui')
  }
  if (!fs.existsSync(PYTHON)) throw new Error(`No Python at ${PYTHON}. See docs/docs/environment/setup.md`)
  // Electron reuses a development backend on the port: the test would run on its data.
  if (await health()) throw new Error(`${BACKEND} already answers. Stop that backend first: the tests start their own.`)
}

function seed(dataDir, profile) {
  const result = spawnSync(PYTHON, [path.join(__dirname, 'seed.py'), profile], {
    cwd: ROOT,
    env: { ...process.env, PYTHONPATH: ROOT, SONORUS_DATA_DIR: dataDir },
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`seed.py failed:\n${result.stderr}`)
}

function startBackend(dataDir) {
  const log = fs.openSync(path.join(dataDir, 'backend.log'), 'a')
  const env = { ...process.env, SONORUS_DATA_DIR: dataDir, PYTHONPATH: ROOT }
  delete env.SONORUS_DEV_UI_ORIGIN
  return spawn(PYTHON, ['-m', 'uvicorn', 'app.api.main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: ROOT, env, stdio: ['ignore', log, log],
  })
}

function stopProcess(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const kill = setTimeout(() => proc.kill('SIGKILL'), 10000)
    proc.once('exit', () => { clearTimeout(kill); resolve() })
    proc.kill('SIGTERM')
  })
}

async function startApp({ seed: profile = 'full' } = {}) {
  await preflight()
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-e2e-'))
  let backend = null
  let app = null
  const stop = async () => {
    await app?.close().catch(() => {})
    await stopProcess(backend)
    if (!process.env.SONORUS_E2E_KEEP) fs.rmSync(dataDir, { recursive: true, force: true })
  }
  try {
    seed(dataDir, profile)
    backend = startBackend(dataDir)
    await waitFor(async () => {
      if (backend.exitCode !== null) throw new Error(`The backend exited, see ${path.join(dataDir, 'backend.log')}`)
      return health()
    }, 'The backend did not answer')

    // Whisper Small is the default already, so no test starts with the toast of a new default.
    const profileDir = path.join(dataDir, 'profile')
    fs.mkdirSync(profileDir)
    fs.writeFileSync(path.join(profileDir, 'settings.json'), JSON.stringify({ transcribeModel: 'small', transcribeModelHistory: ['small'] }))

    const env = { ...process.env }
    delete env.SONORUS_UI_DEV_URL
    app = await electron.launch({ args: [ROOT, `--user-data-dir=${profileDir}`], cwd: ROOT, env })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    return { app, page, dataDir, stop }
  } catch (err) {
    await stop()
    throw err
  }
}

// What the main process saved in settings.json.
function savedSettings(dataDir) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'profile', 'settings.json'), 'utf8'))
}

// The file dialog of the main process answers with these paths instead of asking.
async function stubOpenFiles(app, paths) {
  await app.evaluate(({ ipcMain }, files) => {
    ipcMain.removeHandler('open-files')
    ipcMain.handle('open-files', () => files)
  }, paths)
}

async function api(method, route, body) {
  const res = await fetch(`${BACKEND}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

module.exports = { ROOT, startApp, stubOpenFiles, savedSettings, api }
