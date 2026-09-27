
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
  _activeJobs: new Map(), // jobId → { jobId, title, status, ws, originalRequest, error }

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
    if (this._liveSession) {
      window.showToast?.('Recording is already in progress')
      return
    }
    const overlay = renderNewRecordingModal({
      onStart: settings => this._startLiveRecording(settings),
      onImport: ({ filePath, title, model, language }) => {
        const body = {
          audio_path: filePath,
          whisper_model: model,
          language: language === 'auto' ? null : language,
          title: title || null,
        }
        fetch(`${API_BASE}/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then(r => { if (!r.ok) throw new Error(`Server error ${r.status}`); return r.json() })
          .then(({ job_id }) => this._addJob(job_id, body))
          .catch(err => window.showToast?.(`Could not start: ${err.message}`))
      },
    })
    document.body.appendChild(overlay)
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

    const doTranscribe = async filePath => {
      const body = {
        audio_path: filePath,
        whisper_model: settings.model,
        language: settings.language === 'auto' ? null : settings.language,
        title: settings.title || null,
      }
      try {
        const r = await fetch(`${API_BASE}/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!r.ok) throw new Error(`Server error ${r.status}`)
        const { job_id } = await r.json()
        this._setRecordingActive(false)
        this._addJob(job_id, body)
      } catch (err) {
        this._setRecordingActive(false)
        window.showToast?.(`Could not start transcription: ${err.message}`)
      }
    }

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
      this._setRecordingActive(false)
      window.showToast?.(`Recording error: ${err.message}`)
    }
  },

  // ── Background transcription queue ─────────────────────────────────────────

  _addJob(jobId, body) {
    const fileName = fileBaseName(body.audio_path || '') || 'Recording'
    const title = body.title || fileName
    const job = { jobId, title, status: 'queued', ws: null, originalRequest: body, error: null }
    this._activeJobs.set(jobId, job)
    this._renderJobQueue()

    const ws = new WebSocket(`${WS_BASE}/ws/${jobId}`)
    job.ws = ws

    ws.onmessage = ({ data }) => {
      const event = JSON.parse(data)
      if (event.type === 'heartbeat') return

      if (event.type === 'queued') {
        job.status = 'queued'
      } else if (event.type === 'started') {
        job.status = 'Loading models…'
      } else if (event.type === 'progress') {
        job.status = event.step
      } else if (event.type === 'done') {
        ws.close()
        this._activeJobs.delete(jobId)
        this._renderJobQueue()
        this.invalidateSidebar()
        this._loadSidebar()
        window.showToast?.(`✓ ${job.title}`)
        return
      } else if (event.type === 'cancelled') {
        ws.close()
        this._activeJobs.delete(jobId)
        this._renderJobQueue()
        return
      } else if (event.type === 'error') {
        ws.close()
        if (event.error_code === 'alignment_model_missing') {
          this._activeJobs.delete(jobId)
          this._renderJobQueue()
          document.body.appendChild(renderAlignmentModal(event.language, body))
          return
        }
        job.error = event.message || 'Transcription failed'
      }

      this._renderJobQueue()
    }

    ws.onerror = () => {
      job.error = 'Connection lost'
      this._renderJobQueue()
    }
  },

  _renderJobQueue() {
    const container = document.getElementById('job-queue')
    if (!container) return
    container.innerHTML = ''

    if (this._activeJobs.size === 0) {
      container.style.display = 'none'
      return
    }

    container.style.display = ''
    for (const job of this._activeJobs.values()) {
      container.appendChild(this._makeJobItem(job))
    }
  },

  _makeJobItem(job) {
    const isError  = job.error !== null
    const isQueued = !isError && job.status === 'queued'

    const el = document.createElement('div')
    el.className = 'job-item' + (isError ? ' job-item--error' : '')

    const header = document.createElement('div')
    header.className = 'job-item__header'

    const icon = document.createElement('div')
    icon.className = 'job-item__icon'
    if (isError) {
      icon.classList.add('job-item__icon--error')
      icon.textContent = '!'
    } else if (isQueued) {
      icon.classList.add('job-item__icon--queued')
    } else {
      icon.classList.add('job-item__icon--spinner')
    }

    const titleEl = document.createElement('span')
    titleEl.className = 'job-item__title'
    titleEl.textContent = job.title

    const btn = document.createElement('button')
    btn.className = 'job-item__cancel'
    btn.setAttribute('aria-label', isError ? 'Dismiss' : 'Cancel')
    btn.textContent = '×'

    header.appendChild(icon)
    header.appendChild(titleEl)
    header.appendChild(btn)

    const statusEl = document.createElement('div')
    statusEl.className = 'job-item__status'
    statusEl.textContent = isError
      ? job.error
      : isQueued ? 'Queued' : (job.status || '…')

    el.appendChild(header)
    el.appendChild(statusEl)

    if (isError) {
      btn.addEventListener('click', () => {
        this._activeJobs.delete(job.jobId)
        this._renderJobQueue()
      })
    } else {
      btn.addEventListener('click', () => {
        btn.disabled = true
        fetch(`${API_BASE}/transcribe/${job.jobId}`, { method: 'DELETE' }).catch(() => {})
      })
    }

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
    delEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 18 18" fill="none">
      <path d="M3.5 5h11M7 5V3.5h4V5M5 5l.7 9.5h6.6L13 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
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
      deleteBlockReason: dataResetBlockReason(this._activeJobs.size, this._liveSession),
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
