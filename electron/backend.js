const { app } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const fs   = require('fs')
const { gpuBackendEnv, gpuSupported, markPackError, prepareGpuStart, runProbe } = require('./gpu-pack')
const { reuseDecision, servesDataDir } = require('./backend-identity')

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

// → the GET /health body, {} if something answered that is not a Sonorus
// backend, null if nothing answers on the port.
function checkHealth() {
  return new Promise(resolve => {
    http.get('http://127.0.0.1:8000/health', res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', d => { body += d })
      res.on('end', () => {
        try {
          const health = JSON.parse(body)
          resolve(res.statusCode === 200 && health && typeof health === 'object' ? health : {})
        } catch { resolve({}) }
      })
      res.on('error', () => resolve({}))
    }).on('error', () => resolve(null))
  })
}

// Who this app is, to tell its own backend from another one on the port.
function identity() {
  const userData = app.getPath('userData')
  let dataDir = userData
  // The backend reports the dir with symlinks resolved (/var → /private/var on macOS).
  try { dataDir = fs.realpathSync(userData) } catch { /* not created yet */ }
  return { packaged: app.isPackaged, dataDir, platform: process.platform }
}

// Not a start-up failure of the backend: another one holds port 8000.
class BackendRefusedError extends Error {}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function waitForReady(child, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { dataDir, platform } = identity()
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Backend exited during start-up (${child.exitCode ?? child.signalCode})`)
    }
    // Only our own backend counts: another one may have taken the port meanwhile.
    if (servesDataDir(await checkHealth(), dataDir, platform)) return
    await sleep(600)
  }
  throw new Error('Backend did not respond within 60 seconds')
}

// ── GPU acceleration (electron/gpu-pack.js) ───────────────────────────────────

// → { gpuDir, manifestPath, usePack }, or null where the app offers no GPU download.
async function prepareGpu() {
  const manifestPath = app.isPackaged ? path.join(process.resourcesPath, 'backend', 'gpu-manifest.json') : ''
  if (!gpuSupported({ isPackaged: app.isPackaged, platform: process.platform, manifestPath })) return null
  const gpuDir = path.join(app.getPath('userData'), 'gpu')
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const probe = packDir => runProbe(getPythonExe(), ['-m', 'app.gpu_probe'], {
      cwd: getWorkDir(),
      env: { ...process.env, PYTHONPATH: packDir, PYTHONUNBUFFERED: '1' },
    })
    const { usePack, applied, probe: result } = await prepareGpuStart({
      gpuDir, manifest, appVersion: app.getVersion(), probe,
    })
    if (applied) console.log(`[backend] GPU pack ${applied}`)
    if (result) console.log(`[backend] GPU check: ${result.ok ? `ok (${result.device})` : result.error}`)
    return { gpuDir, manifestPath, usePack }
  } catch (err) {
    console.error(`[backend] GPU pack not used: ${err.message}`)
    return { gpuDir, manifestPath, usePack: false }
  }
}

// ── public API ────────────────────────────────────────────────────────────────

async function startBackend(hfToken = '') {
  // Before anything else (the GPU pack included): a backend that already
  // answers is reused only if it is ours (electron/backend-identity.js).
  const decision = reuseDecision(await checkHealth(), identity())
  if (decision.action === 'reuse') return
  if (decision.action === 'refuse') throw new BackendRefusedError(decision.message)

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
  // GET /health tells whether the packaged app started this backend.
  if (app.isPackaged) env.SONORUS_PACKAGED = '1'
  else delete env.SONORUS_PACKAGED

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

  const gpu = await prepareGpu()
  if (gpu) {
    delete env.PYTHONPATH
    Object.assign(env, gpuBackendEnv(gpu))
  }

  try {
    await spawnBackend(env)
  } catch (err) {
    if (!gpu?.usePack) throw err
    // The pack broke the start (e.g. a library the check did not load): run
    // on the CPU from now on; Settings shows why.
    console.error(`[backend] did not start with GPU acceleration: ${err.message}`)
    await stopBackendAndWait()
    markPackError(gpu.gpuDir, `The backend did not start with GPU acceleration: ${err.message}`)
    delete env.PYTHONPATH
    await spawnBackend(env)
  }
  console.log(`[backend] ready in ${Date.now() - startedAt} ms`)
}

async function spawnBackend(env) {
  const child = spawn(
    getPythonExe(),
    ['-m', 'uvicorn', 'app.api.main:app', '--host', '127.0.0.1', '--port', '8000'],
    { cwd: getWorkDir(), env, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  proc = child

  child.stdout.on('data', d => process.stdout.write(`[backend] ${d}`))
  child.stderr.on('data', d => process.stderr.write(`[backend] ${d}`))
  child.on('exit', () => { if (proc === child) proc = null })

  await waitForReady(child)
}

function stopBackend() {
  if (proc) { proc.kill(); proc = null }
}

// Stop our backend and wait until it is gone and port 8000 is free. Ours is
// the one we started, or one serving our data dir that outlived the app
// (e.g. after a crash) and was reused: that one is stopped by its pid.
async function stopBackendAndWait(timeoutMs = 15000) {
  const child = proc
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill()
    const killer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    await exited
    clearTimeout(killer)
  } else {
    const health = await checkHealth()
    const { dataDir, platform } = identity()
    if (servesDataDir(health, dataDir, platform) && Number.isInteger(health.pid)) {
      try { process.kill(health.pid) } catch { /* already gone */ }
    }
  }
  proc = null
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && await checkHealth() !== null) await sleep(300)
}

// Apply a GPU download or removal: the backend asked for it (POST /gpu/restart).
async function restartBackend(hfToken = '') {
  await stopBackendAndWait()
  // Never reconnect to the backend that was to be restarted: the change
  // would silently not apply.
  if (await checkHealth() !== null) {
    throw new Error('the running backend could not be stopped. Quit Sonorus and start it again to apply the change.')
  }
  await startBackend(hfToken)
}

module.exports = { BackendRefusedError, restartBackend, startBackend, stopBackend }
