// ── Model downloads ──────────────────────────────────────────────────────────
// Downloads belong to the app, not to the Settings page: leaving Settings
// keeps the WebSocket, so a finished download still re-resolves the default
// model (syncTranscribeModel(), with its toast) and coming back shows the
// progress. GET /models does not report running downloads; this module does.
// Subscribers (the Settings page) are told the model id on every change.

const _modelDownloads = {}          // model id → { jobId, ws, pct }
const _modelDownloadListeners = new Set()

// { pct } while `id` downloads, else null.
function modelDownload(id) {
  const d = _modelDownloads[id]
  return d ? { pct: d.pct } : null
}

// Returns the unsubscribe function.
function subscribeModelDownloads(listener) {
  _modelDownloadListeners.add(listener)
  return () => _modelDownloadListeners.delete(listener)
}

function _notifyModelDownload(id) {
  _modelDownloadListeners.forEach(listener => listener(id))
}

function _endModelDownload(id) {
  _modelDownloads[id]?.ws?.close()
  delete _modelDownloads[id]
}

function startModelDownload(id) {
  if (_modelDownloads[id]) return
  const download = { jobId: null, ws: null, pct: 0 }
  _modelDownloads[id] = download
  _notifyModelDownload(id)

  fetch(`${API_BASE}/models/${id}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hf_token: appSettings.hfToken || null }),
  })
    .then(r => r.json())
    .then(({ job_id }) => {
      if (_modelDownloads[id] !== download) {
        // Cancelled before the backend answered: stop the job it started.
        fetch(`${API_BASE}/models/${id}/download/${job_id}`, { method: 'DELETE' }).catch(() => {})
        return
      }
      download.jobId = job_id
      const ws = new WebSocket(`${WS_BASE}/ws/models/${job_id}`)
      download.ws = ws
      ws.onmessage = ({ data }) => {
        const ev = JSON.parse(data)
        if (ev.type === 'progress') {
          download.pct = ev.pct ?? 0
          _notifyModelDownload(id)
        } else if (ev.type === 'done') {
          _endModelDownload(id)
          syncTranscribeModel().finally(() => _notifyModelDownload(id))
        } else if (ev.type === 'cancelled' || ev.type === 'error') {
          _endModelDownload(id)
          _notifyModelDownload(id)
        }
      }
      ws.onerror = () => {
        if (_modelDownloads[id] !== download) return
        _endModelDownload(id)
        _notifyModelDownload(id)
      }
    })
    .catch(() => {
      if (_modelDownloads[id] !== download) return
      _endModelDownload(id)
      _notifyModelDownload(id)
    })
}

function cancelModelDownload(id) {
  const download = _modelDownloads[id]
  if (!download) return Promise.resolve()
  const request = download.jobId
    ? fetch(`${API_BASE}/models/${id}/download/${download.jobId}`, { method: 'DELETE' }).catch(() => {})
    : Promise.resolve()
  return request.finally(() => {
    if (_modelDownloads[id] !== download) return
    _endModelDownload(id)
    _notifyModelDownload(id)
  })
}
