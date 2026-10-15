// ── GPU acceleration ─────────────────────────────────────────────────────────
// The optional CUDA download of the packaged app (Linux, Windows): GET /gpu,
// the download over WS /ws/gpu/{job}, removal, and the restart of the backend
// that applies either. Like model downloads it belongs to the app, not to the
// Settings page: a download finished elsewhere still leads to the restart.
//
// Restart: the backend says when it may restart (POST /gpu/restart → ready, or
// waiting for a transcription / recording / model download; asked again every
// GPU_RESTART_POLL_MS); then the main process restarts it and applies the
// change (electron/gpu-pack.js).

const GPU_RESTART_POLL_MS = 3000

const _gpu = {
  status: null,       // last GET /gpu
  download: null,     // { jobId, ws, pct, phase }
  restart: null,      // { reason } while a restart is pending
  restarting: false,
  loop: 0,            // id of the running restart loop (0 = none)
}
const _gpuListeners = new Set()

function gpuState() {
  const d = _gpu.download
  return {
    status: _gpu.status,
    download: d ? { pct: d.pct, phase: d.phase } : null,
    restart: _gpu.restart,
    restarting: _gpu.restarting,
  }
}

// Returns the unsubscribe function.
function subscribeGpu(listener) {
  _gpuListeners.add(listener)
  return () => _gpuListeners.delete(listener)
}

function _notifyGpu() {
  _gpuListeners.forEach(listener => listener())
}

function formatGpuSize(bytes) {
  return `${(bytes / 1e9).toFixed(1)} GB`
}

async function refreshGpuStatus() {
  try {
    const r = await fetch(`${API_BASE}/gpu`)
    if (!r.ok) return _gpu.status
    _gpu.status = await r.json()
  } catch {
    return _gpu.status
  }
  if (_gpu.status.state === 'pending_restart') _startRestartLoop()
  else if (!_gpu.restarting) _stopRestartLoop()
  _notifyGpu()
  return _gpu.status
}

// ── download ──────────────────────────────────────────────────────────────────

function _endGpuDownload() {
  _gpu.download?.ws?.close()
  _gpu.download = null
}

function startGpuDownload() {
  if (_gpu.download) return
  const download = { jobId: null, ws: null, pct: 0, phase: 'download' }
  _gpu.download = download
  _notifyGpu()

  const failed = message => {
    if (_gpu.download !== download) return
    _endGpuDownload()
    window.showToast?.(`GPU download failed: ${message}`, 'error')
    refreshGpuStatus()
  }

  fetch(`${API_BASE}/gpu/download`, { method: 'POST' })
    .then(async r => {
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.detail || `Server error ${r.status}`)
      return data
    })
    .then(({ job_id }) => {
      if (_gpu.download !== download) {
        // Cancelled before the backend answered: stop the job it started.
        fetch(`${API_BASE}/gpu/download/${job_id}`, { method: 'DELETE' }).catch(() => {})
        return
      }
      download.jobId = job_id
      const ws = new WebSocket(`${WS_BASE}/ws/gpu/${job_id}`)
      download.ws = ws
      ws.onmessage = ({ data }) => {
        const ev = JSON.parse(data)
        if (ev.type === 'progress') {
          download.phase = ev.phase
          if (ev.phase === 'download') download.pct = ev.pct ?? 0
          _notifyGpu()
        } else if (ev.type === 'done' || ev.type === 'cancelled') {
          _endGpuDownload()
          refreshGpuStatus()
        } else if (ev.type === 'error') {
          failed(ev.message)
        }
      }
      ws.onerror = () => failed('the connection to the backend was lost')
    })
    .catch(err => failed(err.message))
}

function cancelGpuDownload() {
  const download = _gpu.download
  if (!download) return Promise.resolve()
  const request = download.jobId
    ? fetch(`${API_BASE}/gpu/download/${download.jobId}`, { method: 'DELETE' }).catch(() => {})
    : Promise.resolve()
  return request.finally(() => {
    if (_gpu.download !== download) return
    _endGpuDownload()
    _notifyGpu()
  })
}

// ── removal ───────────────────────────────────────────────────────────────────

async function removeGpuPack() {
  try {
    const r = await fetch(`${API_BASE}/gpu/pack`, { method: 'DELETE' })
    if (!r.ok) {
      const data = await r.json().catch(() => ({}))
      window.showToast?.(data.detail || `Server error ${r.status}`, 'error')
    }
  } catch { /* backend unreachable; the status below says what is there */ }
  await refreshGpuStatus()
}

// ── restart ───────────────────────────────────────────────────────────────────

function _startRestartLoop() {
  if (_gpu.loop) return
  const loop = Date.now() + Math.random()
  _gpu.loop = loop
  _gpu.restart = { reason: null }
  _restartTick(loop)
}

function _stopRestartLoop() {
  _gpu.loop = 0
  _gpu.restart = null
}

async function _restartTick(loop) {
  if (_gpu.loop !== loop) return
  let answer
  try {
    const r = await fetch(`${API_BASE}/gpu/restart`, { method: 'POST' })
    if (r.status === 409) {
      // Nothing left to apply (e.g. the download was removed).
      _stopRestartLoop()
      await refreshGpuStatus()
      return
    }
    answer = await r.json()
  } catch {
    answer = { status: 'waiting', reason: null }
  }
  if (_gpu.loop !== loop) return

  if (answer.status !== 'ready') {
    _gpu.restart = { reason: answer.reason ?? null }
    _notifyGpu()
    setTimeout(() => _restartTick(loop), GPU_RESTART_POLL_MS)
    return
  }

  const pending = _gpu.status?.pending
  _gpu.restarting = true
  _notifyGpu()
  try {
    await window.electronAPI.restartBackend()
  } catch (err) {
    _gpu.restarting = false
    window.showToast?.(`Could not restart the transcription engine: ${err.message}`, 'error')
    _notifyGpu()
    setTimeout(() => _restartTick(loop), GPU_RESTART_POLL_MS)
    return
  }
  _gpu.restarting = false
  _stopRestartLoop()
  const status = await refreshGpuStatus()
  if (status?.state === 'active') {
    window.showToast?.('GPU acceleration is on')
  } else if (status?.state === 'error') {
    window.showToast?.(`GPU check failed: ${status.error}. Transcription runs on the CPU.`, 'error')
  } else if (pending === 'remove') {
    window.showToast?.('GPU acceleration removed. Transcription runs on the CPU.')
  }
}

// ── what Settings shows ───────────────────────────────────────────────────────

const _GPU_WAIT_TEXT = {
  transcription: 'Applies after the current transcription; the queue goes on afterwards.',
  recording: 'Applies after the recording.',
  model_download: 'Applies after the model download.',
  gpu_download: 'Applies after the download.',
}

// → { hidden, label, tone, detail, device, progress: { pct } | null, actions: [{ id, label, primary }] }
// ui: { download, restart, restarting } from gpuState().
function gpuSectionView(status, ui) {
  if (!status || status.blocked_reason === 'unsupported_platform') return { hidden: true }
  const gpu = status.gpu
  const size = status.download_size ? ` (${formatGpuSize(status.download_size)})` : ''
  const out = (label, tone, detail, actions = [], progress = null) => ({
    hidden: false, label, tone, detail, progress, actions,
    device: status.device === 'cuda' ? 'GPU' : 'CPU',
  })
  const download = label => ({ id: 'download', label: `${label}${size}`, primary: true })
  const remove = { id: 'remove', label: 'Remove', primary: false }

  if (status.blocked_reason === 'not_packaged') {
    return out('Development build', 'neutral',
      `GPU acceleration is downloaded by the installed app. This backend uses PyTorch ${status.torch}.`)
  }
  if (ui.download) {
    const cancel = [{ id: 'cancel', label: 'Cancel', primary: false }]
    return ui.download.phase === 'install'
      ? out('Installing', 'accent', 'Installing the CUDA build of PyTorch.', cancel)
      : out('Downloading', 'accent', 'Downloading the CUDA build of PyTorch.', cancel, { pct: ui.download.pct })
  }
  if (ui.restarting) {
    return out('Restarting', 'accent', 'Restarting the transcription engine…')
  }
  // A download is offered only while the GPU qualifies; removal always.
  const canDownload = !status.blocked_reason
  switch (status.state) {
    case 'pending_restart':
      return out(status.pending === 'remove' ? 'Removing' : 'Waiting to apply', 'accent',
        _GPU_WAIT_TEXT[ui.restart?.reason] || 'Restarting the transcription engine…')
    case 'active':
      return out('On', 'ok', `Transcription runs on ${gpu?.name ?? 'the GPU'}.`, [remove])
    case 'error':
      return out('GPU check failed', 'error', `${status.error}. Transcription runs on the CPU.`,
        canDownload ? [download('Download again'), remove] : [remove])
    case 'stale':
      return out('Update needed', 'amber',
        'This version of Sonorus uses a different PyTorch. Download the update to use the GPU again; until then transcription runs on the CPU.',
        canDownload ? [download('Download update'), remove] : [remove])
  }
  switch (status.blocked_reason) {
    case 'no_nvidia':
      return out('No NVIDIA GPU found', 'neutral',
        'Transcription runs on the CPU. GPU acceleration needs an NVIDIA graphics card.')
    case 'driver_too_old':
      return out('Driver update needed', 'amber',
        `${gpu.name} has driver ${gpu.driver}; GPU acceleration needs ${status.min_driver} or newer. Transcription runs on the CPU.`)
    case 'gpu_too_old':
      return out('GPU not supported', 'neutral',
        `${gpu.name} (compute capability ${gpu.compute_capability}) is too old: PyTorch needs ${status.min_compute_capability} or newer. Transcription runs on the CPU.`)
  }
  return out('Not installed', 'neutral',
    `Transcribe faster on ${gpu?.name ?? 'your NVIDIA GPU'}. Downloads the CUDA build of PyTorch once.`,
    [download('Download')])
}
