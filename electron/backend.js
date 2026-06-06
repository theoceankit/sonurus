const { app } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const fs   = require('fs')

let proc = null

// ── paths ─────────────────────────────────────────────────────────────────────

// SONORUS_TEST_SETUP=1 forces setup mode in dev so the first-run flow
// can be tested without building a packaged app.
function isPackagedMode() {
  return app.isPackaged || process.env.SONORUS_TEST_SETUP === '1'
}

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

// Approximate total download size for requirements.packaged.txt (MB).
// Used as the denominator for download-phase progress.
const TOTAL_DOWNLOAD_MB = 565

// Fallback sizes for when pip omits the size from "Using cached X.whl"
const KNOWN_PKG_SIZES_MB = {
  'torch': 301, 'torchaudio': 34, 'ctranslate2': 95,
  'transformers': 50, 'pytorch-lightning': 30, 'pyannote-audio': 20,
  'faster-whisper': 5, 'whisperx': 3, 'numpy': 30, 'scipy': 30,
  'scikit-learn': 30, 'pandas': 15,
}

function needsSetup() {
  if (!isPackagedMode()) return false
  return !fs.existsSync(path.join(getPkgDir(), '.installed'))
}

// Parses pip stdout/stderr and emits structured progress events:
//   { type: 'phase',    phase: 'resolving'|'downloading'|'installing' }
//   { type: 'progress', phase, downloadedMB, totalMB, speedMBps, etaSeconds,
//                       currentPackage?, currentPackageMB? }
//   { type: 'log',      line }  — raw pip output line
function makeProgressTracker(onProgress) {
  let phase = 'resolving'
  let completedMB = 0     // bytes whose download is confirmed finished
  let currentPkg = null   // { name, sizeMB, startTime } — package being downloaded now
  const speedSamples = [] // recent MB/s measurements (up to 5)

  function avgSpeed() {
    if (!speedSamples.length) return null
    const s = speedSamples.slice(-5)
    return s.reduce((a, b) => a + b, 0) / s.length
  }

  function emitProgress(extra = {}) {
    const speed = avgSpeed()
    // Include current in-flight package in displayed progress for smoother UX
    const displayedMB = completedMB + (currentPkg ? currentPkg.sizeMB : 0)
    const remaining = Math.max(0, TOTAL_DOWNLOAD_MB - displayedMB)
    onProgress({
      type: 'progress',
      phase,
      downloadedMB: Math.round(displayedMB),
      totalMB: TOTAL_DOWNLOAD_MB,
      speedMBps: speed !== null ? Math.round(speed * 10) / 10 : null,
      etaSeconds: (speed && phase === 'downloading' && remaining > 0)
        ? Math.round(remaining / speed)
        : null,
      ...extra,
    })
  }

  function completeCurrentPkg() {
    if (!currentPkg) return
    const elapsed = (Date.now() - currentPkg.startTime) / 1000
    completedMB += currentPkg.sizeMB
    // Only record speed if timing is credible (sequential downloads)
    if (elapsed > 0.5 && currentPkg.sizeMB > 0.5) {
      speedSamples.push(currentPkg.sizeMB / elapsed)
    }
    currentPkg = null
  }

  function startPkg(pkgName, sizeMB) {
    currentPkg = { name: pkgName, sizeMB, startTime: Date.now() }
    if (phase !== 'downloading') {
      phase = 'downloading'
      onProgress({ type: 'phase', phase: 'downloading' })
    }
    emitProgress({ currentPackage: pkgName, currentPackageMB: Math.round(sizeMB) })
  }

  function parseLine(line) {
    // "Downloading X.whl (Y MB)" or "Using cached X.whl (Y MB)"
    const withSize = line.match(
      /(?:Downloading|Using cached)\s+(\S+\.whl)\s+\(([0-9.]+)\s*(GB|MB|kB|B)\)/i
    )
    if (withSize) {
      completeCurrentPkg()
      let sizeMB = parseFloat(withSize[2])
      const unit = withSize[3].toLowerCase()
      if (unit === 'gb')  sizeMB *= 1024
      else if (unit === 'kb') sizeMB /= 1024
      else if (unit === 'b')  sizeMB /= (1024 * 1024)
      const pkgName = withSize[1].replace(/-\d.*$/, '').replace(/_/g, '-')
      startPkg(pkgName, sizeMB)
      return
    }

    // "Using cached X.whl" without size (older pip versions)
    const noSize = line.match(/Using cached\s+(\S+\.whl)\s*$/i)
    if (noSize) {
      completeCurrentPkg()
      const pkgName = noSize[1].replace(/-\d.*$/, '').replace(/_/g, '-')
      startPkg(pkgName, KNOWN_PKG_SIZES_MB[pkgName] ?? 10)
      return
    }

    // "Installing collected packages: torch, torchaudio, ..."
    if (/^Installing collected packages:/i.test(line)) {
      completeCurrentPkg()
      phase = 'installing'
      onProgress({ type: 'phase', phase: 'installing' })
      emitProgress()
    }
  }

  return { parseLine }
}

function runSetup(onProgress) {
  const pkgDir = getPkgDir()
  fs.mkdirSync(pkgDir, { recursive: true })

  onProgress({ type: 'phase', phase: 'resolving' })

  return new Promise((resolve, reject) => {
    const tracker = makeProgressTracker(onProgress)

    const pip = spawn(
      getPythonExe(),
      ['-u', '-m', 'pip', 'install', '-r', getReqFile(),
       '--target', pkgDir, '--no-warn-script-location'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )

    function relay(chunk) {
      chunk.toString().split('\n').forEach(line => {
        line = line.trim()
        if (!line) return
        onProgress({ type: 'log', line })
        tracker.parseLine(line)
      })
    }

    pip.stdout.on('data', relay)
    pip.stderr.on('data', relay)

    pip.on('error', reject)

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

  const firstRun = needsSetup()
  if (firstRun) {
    const cb = onProgress || (() => {})
    await runSetup(cb)
    cb({ type: 'phase', phase: 'starting' })
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

  if (isPackagedMode()) {
    const pkgDir = getPkgDir()
    env.PYTHONPATH = env.PYTHONPATH ? `${pkgDir}${path.delimiter}${env.PYTHONPATH}` : pkgDir

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

  // First run: ML imports from a cold package cache take much longer to load
  await waitForReady(firstRun ? 300_000 : 60_000)
}

function stopBackend() {
  if (proc) { proc.kill(); proc = null }
}

module.exports = { startBackend, stopBackend, needsSetup }
