// GPU acceleration (packaged app on Linux / Windows): the backend downloads
// the CUDA build of PyTorch into <userData>/gpu/incoming (app/services/gpu_pack.py);
// the app owns the backend process, so it is the one that, before a start,
// moves a finished download into gpu/pack, deletes a removed pack, checks a new
// pack (python -m app.gpu_probe) and puts it in front of the bundled libraries
// on PYTHONPATH. gpu/pack.json records the check:
// { torch, status: unchecked | ok | error, error, probed_for_app_version }.

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const PROBE_TIMEOUT_MS = 120000

const paths = gpuDir => ({
  pack:     path.join(gpuDir, 'pack'),
  packJson: path.join(gpuDir, 'pack.json'),
  incoming: path.join(gpuDir, 'incoming'),
  ready:    path.join(gpuDir, 'incoming', 'ready.json'),
  remove:   path.join(gpuDir, 'remove'),
})

const rm = p => fs.rmSync(p, { recursive: true, force: true })

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data))
}

// The backend may run on the GPU: packaged, not macOS, manifest shipped.
function gpuSupported({ isPackaged, platform, manifestPath }) {
  return isPackaged && platform !== 'darwin' && fs.existsSync(manifestPath)
}

// Apply what the backend left for the next start → 'removed' | 'installed' | null.
function applyPendingOps(gpuDir) {
  const p = paths(gpuDir)
  if (fs.existsSync(p.remove)) {
    rm(p.pack)
    rm(p.packJson)
    rm(p.incoming)
    rm(p.remove)
    return 'removed'
  }
  const ready = readJson(p.ready)
  if (ready) {
    rm(p.pack)
    fs.renameSync(path.join(p.incoming, 'pack'), p.pack)
    rm(p.incoming)
    writeJson(p.packJson, { torch: ready.torch, status: 'unchecked' })
    return 'installed'
  }
  // A download the backend did not finish (it was stopped meanwhile).
  rm(p.incoming)
  return null
}

// Before a backend start: apply pending changes, check a new pack (or one an
// app update has not checked yet) → { usePack, applied, probe }.
async function prepareGpuStart({ gpuDir, manifest, appVersion, probe }) {
  const p = paths(gpuDir)
  const applied = applyPendingOps(gpuDir)
  const out = (usePack, result = null) => ({ usePack, applied, probe: result })

  const info = readJson(p.packJson)
  if (!info || !fs.existsSync(p.pack)) return out(false)
  if (info.status === 'error' || info.torch !== manifest.torch) return out(false)
  if (info.status === 'ok' && info.probed_for_app_version === appVersion) return out(true)

  const result = await probe(p.pack)
  writeJson(p.packJson, {
    torch: info.torch,
    status: result.ok ? 'ok' : 'error',
    error: result.ok ? null : (result.error || 'GPU check failed'),
    probed_for_app_version: appVersion,
  })
  return out(!!result.ok, result)
}

// The backend did not come up with the pack: keep it off from now on.
function markPackError(gpuDir, message) {
  const p = paths(gpuDir)
  const info = readJson(p.packJson) || {}
  writeJson(p.packJson, { ...info, status: 'error', error: message })
}

function gpuBackendEnv({ gpuDir, manifestPath, usePack }) {
  const env = { SONORUS_GPU_DIR: gpuDir, SONORUS_GPU_MANIFEST: manifestPath }
  if (usePack) env.PYTHONPATH = paths(gpuDir).pack
  return env
}

// Run the self-check → { ok, torch, device, error } (never throws).
function runProbe(cmd, args, { cwd, env, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let done = false
    let timer = null
    const finish = result => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(result)
    }
    let child
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      finish({ ok: false, error: `GPU check could not start: ${err.message}` })
      return
    }
    timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ ok: false, error: `GPU check did not finish within ${Math.round(timeoutMs / 1000)} s` })
    }, timeoutMs)
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('error', err => finish({ ok: false, error: `GPU check could not start: ${err.message}` }))
    child.on('close', code => {
      const line = stdout.trim().split('\n').reverse().find(l => l.trim().startsWith('{'))
      try {
        if (line) return finish({ ok: false, ...JSON.parse(line), ...(code === 0 ? {} : { ok: false }) })
      } catch { /* not the check's output */ }
      const last = stderr.trim().split('\n').pop() || ''
      finish({ ok: false, error: `GPU check failed (exit code ${code})${last ? `: ${last}` : ''}` })
    })
  })
}

module.exports = { applyPendingOps, gpuBackendEnv, gpuSupported, markPackError, prepareGpuStart, runProbe }
