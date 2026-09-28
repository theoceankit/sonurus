
// ── Settings (persisted to disk via IPC) ────────────────────────────────────
const DEFAULT_APP_SETTINGS = Object.freeze({
  scale: 100,
  transcribeLang: 'auto',
  transcribeModel: 'small',
  exportFormat: 'txt',
  recordingMicDevice: null,
  recordingSystemDevice: null,
  recordingUseMic: true,
  recordingAudioSource: 'both',
  recordingDiarize: true,
  recordingSaveAudio: true,
  hfToken: '',
})

const appSettings = { ...DEFAULT_APP_SETTINGS }

async function loadSettings() {
  const saved = await window.electronAPI.readSettings()
  Object.assign(appSettings, saved)
  window.electronAPI.setZoom(appSettings.scale / 100)
}

async function saveSettings(patch) {
  Object.assign(appSettings, patch)
  await window.electronAPI.writeSettings(appSettings)
}

const app = {
  _activeTranscriptId: null,
  _allRecordings: [],
  _knownSpeakers: {},
  _currentView: 'import',
  _inspectorVisible: true,
  _filter: 'all',
  _section: 'transcripts', // sidebar tab: 'transcripts' | 'speakers'
  _speakers: [],           // every GET /speakers row, named and unnamed
  _speakerQuery: '',
  _speakerFilter: 'all',   // 'all' | 'named' | 'unnamed'
  _activeSpeakerId: null,
  _liveSession: null,    // non-null while a background recording is active
  _queue: null,          // last snapshot from WS /ws/queue (null until connected)
  _queueWs: null,
  _queueDrag: null,      // id of the job card being dragged

  // ── Navigation ──────────────────────────────────────────────────────────────

  _setView(el, editorMode = false) {
    const panel = document.getElementById('main-panel')
    panel.firstElementChild?._cleanup?.()
    panel.innerHTML = ''
    panel.classList.toggle('main-panel--editor', editorMode)
    panel.appendChild(el)
    if (!editorMode) document.getElementById('player-slot').replaceChildren()
    this._updateTitlebarState()
  },

  _updateTitlebarState() {
    const backBtn = document.getElementById('tb-back')
    if (backBtn) backBtn.disabled = (this._currentView === 'import')
    const inspBtn = document.getElementById('tb-inspector-toggle')
    if (inspBtn) inspBtn.classList.toggle('tb-tool--active', this._inspectorVisible)

  },

  showHome() {
    this._showSection('transcripts')
    this._currentView = 'import'
    this._activeTranscriptId = null
    this._rerenderList()
    this._setView(document.createElement('div'), false)
  },

  showSettings() {
    this._currentView = 'settings'
    this._activeTranscriptId = null
    document.getElementById('btn-import').classList.remove('sb-new-btn--active')
    this._rerenderList()
    this._rerenderSpeakerList()
    this._setView(renderSettingsView(), false)
  },

  openNewRecordingModal() {
    const overlay = renderNewRecordingModal({
      // While recording, the modal only imports (the queue waits for the recording).
      recording: !!this._liveSession,
      onStart: settings => this._startLiveRecording(settings),
      onImport: ({ filePath, title, model, language }) =>
        this._importFiles([filePath], { title, model, language }),
    })
    document.body.appendChild(overlay)
  },

  // ── Import ──────────────────────────────────────────────────────────────────

  // Adds files to the transcription queue, one request at a time: the backend
  // copies each file into recordings/ before it answers, and the queue keeps
  // the order the files came in. The queue section updates from WS /ws/queue.
  async _importFiles(paths, options) {
    for (const filePath of paths) {
      const { url, method, body } = importRequest(filePath, options)
      try {
        const r = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!r.ok) {
          const data = await r.json().catch(() => ({}))
          throw new Error(data.detail || `Server error ${r.status}`)
        }
      } catch (err) {
        window.showToast?.(`Could not add ${fileBaseName(filePath)}: ${err.message}`, 'error')
      }
    }
  },

  _fileDropState() {
    return {
      view: this._currentView,
      modalOpen: !!document.querySelector('.nr-overlay'),
    }
  },

  _onFileDrop(decision) {
    if (decision.action !== 'import') return
    const { files, skipped } = decision
    if (skipped) window.showToast?.(`Skipped ${skipped} unsupported file${skipped === 1 ? '' : 's'}`)
    if (!files.length) return
    window.showToast?.(files.length === 1 ? `Importing ${files[0].name}…` : `Importing ${files.length} files…`)
    this._importFiles(files.map(file => file.path), {
      model: appSettings.transcribeModel || 'large-v3',
      language: appSettings.transcribeLang || 'auto',
    })
  },

  showEditor(transcriptId) {
    this._showSection('transcripts')
    this._currentView = 'editor'
    this._activeTranscriptId = transcriptId
    this._lastTranscriptId = transcriptId
    document.getElementById('btn-import').classList.remove('sb-new-btn--active')
    this._rerenderList()
    const meta = (this._allRecordings || []).find(r => r.id === transcriptId) || null
    this._setView(renderEditorView(transcriptId, meta), true)
    // Only reload sidebar when data may have changed (commit, delete, rename).
    // Navigating between existing transcripts does not need a full refresh.
    if (this._sidebarDirty !== false) this._loadSidebar()
    // Restore inspector visibility after editor rebuilds
    const rightPanel = document.querySelector('.right-panel')
    if (rightPanel) rightPanel.style.display = this._inspectorVisible ? '' : 'none'
  },

  invalidateSidebar() { this._sidebarDirty = true },

  // ── Background recording ────────────────────────────────────────────────────

  _setRecordingActive(active) {
    const btn = document.getElementById('tb-record')
    const sep = document.getElementById('tb-sep-record')
    if (!btn || !sep) return
    btn.style.display  = active ? '' : 'none'
    sep.style.display  = active ? '' : 'none'
    if (!active) document.getElementById('tb-record-label').textContent = 'Record'
  },

  async _startLiveRecording(settings) {
    const {
      audioSource    = 'both',
      micDeviceId    = null,
      systemDeviceId = null,
      title          = '',
      model          = appSettings.transcribeModel || 'large-v3',
      language       = appSettings.transcribeLang  || 'auto',
    } = settings

    this._setRecordingActive(true)
    const labelEl = document.getElementById('tb-record-label')
    if (labelEl) labelEl.textContent = 'Starting…'
    const btn = document.getElementById('tb-record')
    if (btn) btn.disabled = true
    // Frees the CPU/GPU for the recording: the running transcription stops.
    await this._queueRecording('start')

    let recorder = null, audioCtx = null
    let micStream = null, sysStream = null
    let captureJobId = null, chunks = []

    try {
      const platform = await window.electronAPI.getPlatform()

      if (audioSource !== 'system') {
        const constraint = micDeviceId ? { deviceId: { exact: micDeviceId } } : true
        micStream = await navigator.mediaDevices.getUserMedia({ audio: constraint })
      }

      if (audioSource !== 'mic') {
        const isBackendCapture = platform !== 'win32'
          && systemDeviceId
          && systemDeviceId !== '__default__'
          && systemDeviceId !== '__desktop__'

        if (isBackendCapture) {
          const resp = await fetch(`${API_BASE}/audio/capture/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_id: systemDeviceId }),
          })
          if (!resp.ok) {
            const data = await resp.json().catch(() => ({}))
            const msg = data.detail || 'Failed to start system audio capture.'
            const isPerm = /permission|denied|SCStream|TCC|Screen Recording/i.test(msg)
            throw new Error(isPerm
              ? 'Screen Recording access is required. Open System Settings → Privacy & Security → Screen Recording and enable Sonorus, then try again.'
              : msg)
          }
          captureJobId = (await resp.json()).job_id
        } else if (systemDeviceId === '__desktop__') {
          const displayStream = await navigator.mediaDevices.getDisplayMedia({
            audio: true, video: { width: 1, height: 1 },
          })
          displayStream.getVideoTracks().forEach(t => { t.stop(); displayStream.removeTrack(t) })
          if (displayStream.getAudioTracks().length === 0)
            throw new Error('System audio not captured: the screen share returned no audio.')
          sysStream = displayStream
        }
      }

      if (!micStream && !sysStream && !captureJobId)
        throw new Error('No audio source available. Check device permissions.')

      audioCtx = new AudioContext()
      const dest = audioCtx.createMediaStreamDestination()
      if (micStream) { const s = audioCtx.createMediaStreamSource(micStream); s.connect(dest) }
      if (sysStream) { const s = audioCtx.createMediaStreamSource(sysStream); s.connect(dest) }

      if (micStream || sysStream) {
        chunks = []
        recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' })
        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
        recorder.start(1000)
      }
    } catch (err) {
      micStream?.getTracks().forEach(t => t.stop())
      sysStream?.getTracks().forEach(t => t.stop())
      audioCtx?.close()
      if (captureJobId) {
        fetch(`${API_BASE}/audio/capture/stop/${captureJobId}`, { method: 'POST' }).catch(() => {})
      }
      this._setRecordingActive(false)
      this._queueRecording('stop')
      window.showToast?.(`Could not start recording: ${err.message}`)
      return
    }

    if (btn) btn.disabled = false

    let elapsed = 0
    const timerInterval = setInterval(() => {
      elapsed++
      const m = Math.floor(elapsed / 60)
      const s = String(elapsed % 60).padStart(2, '0')
      const el = document.getElementById('tb-record-label')
      if (el) el.textContent = `${m}:${s}`
    }, 1000)
    if (labelEl) labelEl.textContent = '0:00'

    this._liveSession = {
      recorder, audioCtx, micStream, sysStream,
      captureJobId, chunks, timerInterval,
      settings: { title, model, language },
    }
  },

  async _stopLiveRecording() {
    const session = this._liveSession
    if (!session) return
    this._liveSession = null

    clearInterval(session.timerInterval)
    const btn = document.getElementById('tb-record')
    const labelEl = document.getElementById('tb-record-label')
    if (btn) btn.disabled = true
    if (labelEl) labelEl.textContent = 'Stopping…'

    const { recorder, audioCtx, micStream, sysStream, captureJobId, chunks, settings } = session

    // The new recording joins the end of the queue.
    const doTranscribe = filePath => this._importFiles([filePath], {
      title: settings.title, model: settings.model, language: settings.language,
    })

    const saveBrowserChunks = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm;codecs=opus' })
      return window.electronAPI.saveRecording(await blob.arrayBuffer(), 'webm')
    }

    try {
      if (captureJobId && recorder) {
        await new Promise((resolve, reject) => {
          recorder.onstop = async () => {
            try {
              const micPath = await saveBrowserChunks()
              micStream?.getTracks().forEach(t => t.stop())
              audioCtx?.close()
              const r = await fetch(`${API_BASE}/audio/capture/stop/${captureJobId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mic_path: micPath }),
              })
              if (!r.ok) {
                const data = await r.json().catch(() => ({}))
                throw new Error(data.detail || 'Failed to stop audio capture.')
              }
              resolve((await r.json()).file_path)
            } catch (err) { reject(err) }
          }
          recorder.stop()
        }).then(filePath => doTranscribe(filePath))

      } else if (captureJobId) {
        sysStream?.getTracks().forEach(t => t.stop())
        audioCtx?.close()
        const r = await fetch(`${API_BASE}/audio/capture/stop/${captureJobId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!r.ok) {
          const data = await r.json().catch(() => ({}))
          throw new Error(data.detail || 'Failed to stop audio capture.')
        }
        await doTranscribe((await r.json()).file_path)

      } else {
        await new Promise((resolve, reject) => {
          recorder.onstop = async () => {
            try {
              micStream?.getTracks().forEach(t => t.stop())
              sysStream?.getTracks().forEach(t => t.stop())
              audioCtx?.close()
              resolve(await saveBrowserChunks())
            } catch (err) { reject(err) }
          }
          recorder.stop()
        }).then(filePath => doTranscribe(filePath))
      }
    } catch (err) {
      window.showToast?.(`Recording error: ${err.message}`)
    } finally {
      this._setRecordingActive(false)
      // After the recording was queued: the queue may resume (auto mode).
      await this._queueRecording('stop')
    }
  },

  // ── Transcription queue ─────────────────────────────────────────────────────
  // The backend owns the queue; WS /ws/queue sends a snapshot after every
  // change plus job_done / job_failed.

  _connectQueue() {
    const ws = new WebSocket(`${WS_BASE}/ws/queue`)
    this._queueWs = ws
    ws.onmessage = ({ data }) => this._onQueueEvent(JSON.parse(data))
    ws.onclose = () => {
      if (this._queueWs !== ws) return
      this._queueWs = null
      setTimeout(() => this._connectQueue(), 2000) // backend restarting
    }
  },

  _onQueueEvent(event) {
    if (event.type === 'snapshot') {
      this._queue = event
      // Rebuilding the cards would end a drag; dragend renders the latest.
      if (!this._queueDrag) this._renderJobQueue()
    } else if (event.type === 'job_done') {
      this.invalidateSidebar()
      this._loadSidebar()
      window.showToast?.(`✓ ${event.title}`)
    } else if (event.type === 'job_failed') {
      if (event.error_code === 'alignment_model_missing') {
        document.body.appendChild(renderAlignmentModal(event.error_language, event.job_id))
      } else {
        window.showToast?.(`Transcription failed: ${event.title}`, 'error')
      }
    }
  },

  // Queue API call; errors become a toast. Returns the response body or null.
  async _queueRequest(path, { method = 'POST', body } = {}) {
    try {
      const r = await fetch(`${API_BASE}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.detail || `Server error ${r.status}`)
      return data
    } catch (err) {
      window.showToast?.(err.message, 'error')
      return null
    }
  },

  // A live recording pauses the queue; never fails the recording itself.
  _queueRecording(state) {
    return fetch(`${API_BASE}/queue/recording/${state}`, { method: 'POST' }).catch(() => {})
  },

  _renderJobQueue() {
    const container = document.getElementById('job-queue')
    if (!container) return
    const q = this._queue
    container.replaceChildren()
    if (!queueJobCount(q)) {
      container.style.display = 'none'
      return
    }
    container.style.display = ''
    container.appendChild(this._makeQueueHeader(q))
    for (const job of q.jobs) container.appendChild(this._makeJobItem(job, q))
  },

  // Drag a card onto another to reorder (PUT /queue/order). Only drags that
  // carry a job id are handled; file drops are file-drop.js's.
  _attachJobDrag(el, job) {
    const TYPE = 'application/x-sonorus-job'
    const container = document.getElementById('job-queue')
    const clearMarks = () => container.querySelectorAll('.job-item--drop-before, .job-item--drop-after')
      .forEach(c => c.classList.remove('job-item--drop-before', 'job-item--drop-after'))

    el.draggable = true
    el.addEventListener('dragstart', e => {
      if (e.target.closest('button')) { e.preventDefault(); return }
      e.dataTransfer.setData(TYPE, job.id)
      e.dataTransfer.effectAllowed = 'move'
      this._queueDrag = job.id
      el.classList.add('job-item--dragging')
    })
    el.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes(TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const place = dropPlace(el.getBoundingClientRect(), e.clientY)
      clearMarks()
      if (this._queueDrag !== job.id) el.classList.add(`job-item--drop-${place}`)
    })
    el.addEventListener('drop', e => {
      if (!e.dataTransfer.types.includes(TYPE)) return
      e.preventDefault()
      const dragged = e.dataTransfer.getData(TYPE)
      const ids = this._queue.jobs.map(j => j.id)
      const order = reorderJobIds(ids, dragged, job.id, dropPlace(el.getBoundingClientRect(), e.clientY))
      if (order.some((id, i) => id !== ids[i])) {
        this._queueRequest('/queue/order', { method: 'PUT', body: { job_ids: order } })
      }
    })
    el.addEventListener('dragend', () => {
      this._queueDrag = null
      this._renderJobQueue()
    })
    el.addEventListener('dragleave', e => {
      if (!el.contains(e.relatedTarget)) el.classList.remove('job-item--drop-before', 'job-item--drop-after')
    })
  },

  _openJobEdit(job) {
    openJobEditModal({
      job,
      onSubmit: async patch => {
        const { url, method, body } = jobEditRequest(job.id, patch)
        const r = await fetch(url, {
          method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        if (!r.ok) {
          const data = await r.json().catch(() => ({}))
          const detail = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail
          throw new Error(detail || `Server error ${r.status}`)
        }
      },
    })
  },

  _makeQueueHeader(q) {
    const header = document.createElement('div')
    header.className = 'job-queue__header'

    const title = document.createElement('span')
    title.className = 'job-queue__title'
    title.textContent = `Queue · ${queueJobCount(q)}`

    const state = document.createElement('span')
    state.className = 'job-queue__state' + (q.paused ? ' job-queue__state--paused' : '')
    state.textContent = queueStateLabel(q)

    const toggle = queueToggle(q)
    const btn = document.createElement('button')
    btn.className = 'job-queue__toggle'
    btn.innerHTML = `${icon(toggle.icon, 10)}<span></span>`
    btn.lastChild.textContent = toggle.label
    btn.addEventListener('click', () => {
      btn.disabled = true
      this._queueRequest(`/queue/${toggle.action}`)
    })

    header.append(title, state, btn)
    return header
  },

  _makeJobItem(job, q) {
    const failed  = job.status === 'failed'
    const running = job.status === 'running'

    const el = document.createElement('div')
    el.className = 'job-item' + (failed ? ' job-item--error' : '')

    const header = document.createElement('div')
    header.className = 'job-item__header'

    const mark = document.createElement('div')
    mark.className = 'job-item__icon'
    if (failed) {
      mark.classList.add('job-item__icon--error')
      mark.textContent = '!'
    } else if (running && !q.paused) {
      mark.classList.add('job-item__icon--spinner')
    } else {
      mark.classList.add('job-item__icon--queued')
    }

    const titleEl = document.createElement('span')
    titleEl.className = 'job-item__title'
    titleEl.textContent = job.title
    titleEl.title = job.title
    header.append(mark, titleEl)

    if (canEditJob(job)) {
      const editBtn = document.createElement('button')
      editBtn.className = 'job-item__action'
      editBtn.title = 'Transcription settings'
      editBtn.setAttribute('aria-label', 'Edit')
      editBtn.innerHTML = icon('edit', 11)
      editBtn.addEventListener('click', () => this._openJobEdit(job))
      header.appendChild(editBtn)
    }

    if (failed) {
      const retry = document.createElement('button')
      retry.className = 'job-item__action'
      retry.title = 'Retry'
      retry.setAttribute('aria-label', 'Retry')
      retry.innerHTML = icon('retry', 11)
      retry.addEventListener('click', () => {
        retry.disabled = true
        this._queueRequest(`/queue/jobs/${job.id}/retry`)
      })
      header.appendChild(retry)
    }

    const del = document.createElement('button')
    del.className = 'job-item__action'
    del.title = 'Delete'
    del.setAttribute('aria-label', 'Delete')
    del.textContent = '×'
    del.addEventListener('click', () => openConfirmDialog({
      ...deleteJobPrompt(job),
      onConfirm: () => this._queueRequest(`/queue/jobs/${job.id}`, { method: 'DELETE' }),
    }))
    header.appendChild(del)

    const statusEl = document.createElement('div')
    statusEl.className = 'job-item__status'
    statusEl.textContent = jobStatusText(job, q)
    if (failed && job.error) statusEl.title = job.error

    el.append(header, statusEl)
    this._attachJobDrag(el, job)
    return el
  },

  // ── Titlebar actions ────────────────────────────────────────────────────────

  toggleInspector() {
    this._inspectorVisible = !this._inspectorVisible
    const rightPanel = document.querySelector('.right-panel')
    if (rightPanel) rightPanel.style.display = this._inspectorVisible ? '' : 'none'
    this._updateTitlebarState()
  },

  // ── Sidebar ─────────────────────────────────────────────────────────────────

  _loadSidebar({ autoOpen = false } = {}) {
    this._sidebarDirty = false
    Promise.all([
      fetch(`${API_BASE}/transcripts`).then(r => r.json()),
      fetch(`${API_BASE}/speakers`).then(r => r.json()),
    ]).then(([items, speakers]) => {
      this._allRecordings = items
      this._speakers = speakers
      this._knownSpeakers = buildKnownMap(speakers)
      this._rerenderList()
      this._rerenderSpeakerList()
      if (autoOpen) {
        if (items.length > 0) this.showEditor(items[0].id)
        else { this.showHome(); this.openNewRecordingModal() }
      }
    }).catch(() => { if (autoOpen) { this.showHome(); this.openNewRecordingModal() } })
  },

  // TODO(not implemented): the API has no `source` field and no marks yet, so
  // "Notes" is always empty and "Marked" shows everything. The titlebar search
  // (#tb-search-btn) has no handler. See roadmap "UI without business logic".
  _applyFilter(items) {
    if (this._filter === 'recordings') return items.filter(r => r.source !== 'note')
    if (this._filter === 'notes')      return items.filter(r => r.source === 'note')
    return items
  },

  _rerenderList(query = '') {
    const list = document.getElementById('recordings-list')
    if (!list) return

    // update header count
    const hdrCount = document.getElementById('sb-header-count')
    if (hdrCount) hdrCount.textContent = this._allRecordings.length || ''

    // update All chip count
    const allCount = document.getElementById('filter-count-all')
    if (allCount) allCount.textContent = this._allRecordings.length || ''

    const items = this._applyFilter(this._allRecordings)

    list.innerHTML = ''

    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'sb-empty'
      empty.textContent = query
        ? 'No results'
        : this._filter !== 'all' ? 'Nothing here yet' : 'No recordings yet'
      list.appendChild(empty)
      return
    }

    items.forEach(item => list.appendChild(this._makeRecordingItem(item)))
  },

  _makeRecordingItem(item) {
    const isActive = item.id === this._activeTranscriptId
    const btn = document.createElement('button')
    btn.className = 'rec-item' + (isActive ? ' rec-item--active' : '')

    // Title row: name (left) + time (right)
    const titleEl = document.createElement('div')
    titleEl.className = 'rec-item-title'

    const titleText = document.createElement('span')
    titleText.className = 'rec-item-title-text'
    titleText.textContent = item.title
    titleEl.appendChild(titleText)

    if (item.created_at) {
      const d = new Date(item.created_at)
      const timeEl = document.createElement('span')
      timeEl.className = 'rec-item-time'
      timeEl.textContent = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      titleEl.appendChild(timeEl)
    }

    // Delete icon — replaces the time on hover. A span, not a nested button
    // (the item itself is a <button>).
    const delEl = document.createElement('span')
    delEl.className = 'rec-item-delete'
    delEl.setAttribute('role', 'button')
    delEl.title = 'Delete transcript'
    delEl.innerHTML = icon('delete', 14)
    delEl.addEventListener('click', e => {
      e.stopPropagation()
      this._confirmDeleteTranscript(item)
    })
    titleEl.appendChild(delEl)

    btn.appendChild(titleEl)

    // Meta row: duration + avatars
    const metaEl = document.createElement('div')
    metaEl.className = 'rec-item-meta'

    if (item.duration) {
      const durEl = document.createElement('span')
      durEl.className = 'rec-item-dur'
      durEl.textContent = item.duration
      metaEl.appendChild(durEl)
    }

    // Stacked speaker avatars (right-aligned)
    const speakers = (item.speakers || []).filter(Boolean).slice(0, 3)
    if (speakers.length > 0) {
      const spacer = document.createElement('div')
      spacer.style.flex = '1'
      metaEl.appendChild(spacer)

      const stack = document.createElement('div')
      stack.className = 'rec-avatars'
      const ringColor = isActive ? '#0A84FF' : 'var(--sidebar-bg)'

      speakers.forEach(spkId => {
        const av = document.createElement('div')
        av.className = 'rec-avatar'
        av.style.boxShadow = `0 0 0 1.5px ${ringColor}`

        if (isUnrecognized(spkId, this._knownSpeakers)) {
          av.style.background = 'color-mix(in srgb, black 10%, var(--sidebar-bg))'
          av.style.color = 'rgba(0,0,0,0.45)'
          av.textContent = '?'
        } else {
          const p = speakerPalette(spkId, this._knownSpeakers)
          av.style.background = p.color
          av.textContent = speakerInitials(this._knownSpeakers[spkId]?.name || spkId)
        }
        stack.appendChild(av)
      })
      metaEl.appendChild(stack)
    }

    btn.appendChild(metaEl)
    btn.addEventListener('click', () => this.showEditor(item.id))
    return btn
  },

  _confirmDeleteTranscript(item) {
    const { title, body } = deleteTranscriptPrompt(item.title)
    openConfirmDialog({
      title, body, confirmLabel: 'Delete',
      onConfirm: () => this._deleteTranscript(item),
    })
  },

  async _deleteTranscript(item) {
    try {
      const r = await fetch(`${API_BASE}/transcripts/${item.id}`, { method: 'DELETE' })
      if (!r.ok && r.status !== 404) throw new Error(`Server error ${r.status}`)
    } catch (err) {
      window.showToast?.(`Could not delete: ${err.message}`, 'error')
      return
    }
    this._allRecordings = withoutRecording(this._allRecordings, item.id)
    if (this._activeTranscriptId === item.id) this.showHome()
    else this._rerenderList()
    this._loadSidebar()
    window.showToast?.(`Deleted “${item.title}”.`)
  },

  _setFilter(filter) {
    this._filter = filter
    document.querySelectorAll('#sb-filter .sb-filter-btn').forEach(btn => {
      btn.classList.toggle('sb-filter-btn--active', btn.dataset.filter === filter)
    })
    this._rerenderList()
  },

  // ── Speakers section ────────────────────────────────────────────────────────

  // Sidebar tab + pane only; does not change the main panel.
  _showSection(section) {
    this._section = section
    document.querySelectorAll('.sb-tab').forEach(tab => {
      const active = tab.dataset.section === section
      tab.classList.toggle('sb-tab--active', active)
      tab.setAttribute('aria-selected', String(active))
    })
    document.getElementById('sb-pane-transcripts').hidden = section !== 'transcripts'
    document.getElementById('sb-pane-speakers').hidden = section !== 'speakers'
  },

  _onSectionTab(section) {
    if (section === this._section) return
    if (section === 'speakers') { this.showSpeakers(); return }
    const last = this._lastTranscriptId
    if (last != null && this._allRecordings.some(r => r.id === last)) this.showEditor(last)
    else this.showHome()
  },

  showSpeakers() {
    this._showSection('speakers')
    if (this._activeTranscriptId != null) this._lastTranscriptId = this._activeTranscriptId
    this._activeTranscriptId = null
    this._rerenderList()
    const active = this._speakers.find(s => s.id === this._activeSpeakerId)
    if (active) { this.showSpeaker(active.id); return }
    this._activeSpeakerId = null
    this._currentView = 'speakers'
    this._rerenderSpeakerList()
    this._setView(renderSpeakersPlaceholder(
      this._speakers.length ? 'Select a speaker to see and edit their details.' : 'No speakers yet.'
    ), false)
  },

  showSpeaker(speakerId) {
    const row = this._speakers.find(s => s.id === speakerId)
    if (!row) { this._activeSpeakerId = null; this.showSpeakers(); return }
    this._showSection('speakers')
    this._currentView = 'speakers'
    this._activeSpeakerId = speakerId
    this._rerenderSpeakerList()
    this._setView(renderSpeakerDetail(row, {
      duplicate: duplicateNameIds(this._speakers).has(speakerId),
      deleteBlockReason: dataResetBlockReason(this._queue?.running_job_id ? 1 : 0, this._liveSession),
      onSave: patch => this._updateSpeaker(row, patch),
      onDelete: () => this._confirmDeleteSpeaker(row),
      onOpenTranscript: id => this.showEditor(id),
    }), false)
  },

  async _updateSpeaker(row, patch) {
    const r = await fetch(`${API_BASE}/speakers/${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) {
      const detail = typeof body.detail === 'string' ? body.detail : `Server error ${r.status}`
      throw new Error(detail)
    }
    this._speakers = this._speakers.map(s => s.id === row.id ? { ...s, ...body } : s)
    this._knownSpeakers = buildKnownMap(this._speakers)
    this.invalidateSidebar()
    this._rerenderList()
    this.showSpeaker(row.id)
    this._loadSidebar()
  },

  _confirmDeleteSpeaker(row) {
    const { title, body } = deleteSpeakerPrompt(row)
    openConfirmDialog({
      title, body, confirmLabel: 'Delete',
      onConfirm: () => this._deleteSpeaker(row),
    })
  },

  async _deleteSpeaker(row) {
    let result
    try {
      const r = await fetch(`${API_BASE}/speakers/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      result = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(typeof result.detail === 'string' ? result.detail : `Server error ${r.status}`)
    } catch (err) {
      window.showToast?.(`Could not delete: ${err.message}`, 'error')
      return
    }
    this._speakers = this._speakers.filter(s => s.id !== row.id)
    this._knownSpeakers = buildKnownMap(this._speakers)
    this._activeSpeakerId = null
    this.invalidateSidebar()
    this.showSpeakers()
    this._loadSidebar()
    const unassigned = result.segments ? ` ${result.segments} segment${result.segments === 1 ? ' is' : 's are'} now Unassigned.` : ''
    window.showToast?.(`Deleted “${speakerDisplayName(row)}”.${unassigned}`)
  },

  _setSpeakerFilter(filter) {
    this._speakerFilter = filter
    document.querySelectorAll('#sb-speaker-filter .sb-filter-btn').forEach(btn => {
      btn.classList.toggle('sb-filter-btn--active', btn.dataset.filter === filter)
    })
    this._rerenderSpeakerList()
  },

  _rerenderSpeakerList() {
    const list = document.getElementById('speakers-list')
    if (!list) return
    const all = this._speakers
    const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n || '' }
    setCount('sb-speakers-count', all.length)
    setCount('speaker-count-all', all.length)
    setCount('speaker-count-named', all.filter(s => s.name).length)
    setCount('speaker-count-unnamed', all.filter(s => !s.name).length)

    const items = filterSpeakers(all, this._speakerQuery, this._speakerFilter)
    list.replaceChildren()
    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'sb-empty'
      empty.textContent = this._speakerQuery.trim() ? 'No speakers match'
        : this._speakerFilter === 'named' ? 'No named speakers'
        : this._speakerFilter === 'unnamed' ? 'No unnamed speakers'
        : 'No speakers yet'
      list.appendChild(empty)
      return
    }
    const dups = duplicateNameIds(all)
    items.forEach(row => list.appendChild(makeSpeakerListItem(row, {
      active: row.id === this._activeSpeakerId && this._currentView === 'speakers',
      duplicate: dups.has(row.id),
      onClick: () => this.showSpeaker(row.id),
    })))
  },

  // ── Init ────────────────────────────────────────────────────────────────────

  init() {
    loadSettings().then(() => this._loadSidebar({ autoOpen: true }))
    this._connectQueue()

    initFileDrop({
      getState: () => this._fileDropState(),
      onDrop: decision => this._onFileDrop(decision),
    })

    // ── Sidebar buttons ────────────────────────────────────────────────────────
    document.getElementById('btn-import')
      .addEventListener('click', () => this.openNewRecordingModal())

    document.getElementById('btn-settings')
      .addEventListener('click', () => this.showSettings())

    // ── Sidebar section tabs + speakers search/filter ─────────────────────────
    document.getElementById('sb-tabs')
      .addEventListener('click', e => {
        const tab = e.target.closest('.sb-tab')
        if (tab) this._onSectionTab(tab.dataset.section)
      })
    document.getElementById('speaker-search')
      .addEventListener('input', e => { this._speakerQuery = e.target.value; this._rerenderSpeakerList() })
    document.getElementById('sb-speaker-filter')
      .addEventListener('click', e => {
        const btn = e.target.closest('.sb-filter-btn')
        if (btn) this._setSpeakerFilter(btn.dataset.filter)
      })

    // ── Filter chips ──────────────────────────────────────────────────────────
    document.getElementById('sb-filter')
      .addEventListener('click', e => {
        const btn = e.target.closest('.sb-filter-btn')
        if (btn) this._setFilter(btn.dataset.filter)
      })

    // ── Titlebar — navigation ──────────────────────────────────────────────────
    document.getElementById('tb-back')
      .addEventListener('click', () => { if (this._currentView !== 'import') this.showHome() })

    // ── Titlebar — export / share ──────────────────────────────────────────────
    const exportBtn = document.getElementById('tb-export')
    attachSegTooltip(exportBtn, 'below')
    // TODO(not implemented): ignores Settings → Export (format, include-* options)
    exportBtn.addEventListener('click', () => {
      const rows = document.querySelectorAll('.seg-row')
      if (!rows.length) return
      const lines = []
      rows.forEach(row => {
        const time = row.querySelector('.seg-time span')?.textContent || ''
        const spk  = row.querySelector('.seg-speaker-name')?.textContent || ''
        const text = row.querySelector('.seg-text')?.textContent || ''
        lines.push(`[${time}] ${spk}: ${text}`)
      })
      window.electronAPI.writeClipboard(lines.join('\n'))
        .then(() => window.showToast?.('Copied to clipboard'))
        .catch(() => window.showToast?.('Copy failed'))
    })

    const shareBtn = document.getElementById('tb-share')
    attachSegTooltip(shareBtn, 'below')
    shareBtn.addEventListener('click', () => window.showToast?.('Share is not available yet'))



    // ── Titlebar — record ──────────────────────────────────────────────────────
    document.getElementById('tb-record')
      .addEventListener('click', () => this._stopLiveRecording())

    // ── Titlebar — panels ──────────────────────────────────────────────────────
    document.getElementById('tb-inspector-toggle')
      .addEventListener('click', () => this.toggleInspector())
  },
}

app.init()
