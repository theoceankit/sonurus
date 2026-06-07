
// ── Settings (persisted to disk via IPC) ────────────────────────────────────
const appSettings = {
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
}

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
  _liveSession: null,   // non-null while a background recording is active

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
    this._currentView = 'import'
    this._activeTranscriptId = null
    this._rerenderList()
    this._setView(document.createElement('div'), false)
  },

  showProgress(jobId, originalRequest = null) {
    this._currentView = 'progress'
    document.getElementById('btn-import').classList.remove('sb-new-btn--active')
    this._setView(renderProgressView(jobId, originalRequest), false)
  },

  showSettings() {
    this._currentView = 'settings'
    this._activeTranscriptId = null
    document.getElementById('btn-import').classList.remove('sb-new-btn--active')
    this._rerenderList()
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
          .then(({ job_id }) => this.showProgress(job_id, body))
          .catch(err => window.showToast?.(`Could not start: ${err.message}`))
      },
    })
    document.body.appendChild(overlay)
  },

  showEditor(transcriptId) {
    this._currentView = 'editor'
    this._activeTranscriptId = transcriptId
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
      captureJobId, chunks, elapsed, timerInterval,
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
    const elapsed = session.elapsed

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
        this.showProgress(job_id, body)
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
      this._knownSpeakers = {}
      speakers.forEach(s => { this._knownSpeakers[s.id] = s.name })
      this._rerenderList()
      if (autoOpen) {
        if (items.length > 0) this.showEditor(items[0].id)
        else { this.showHome(); this.openNewRecordingModal() }
      }
    }).catch(() => { if (autoOpen) { this.showHome(); this.openNewRecordingModal() } })
  },

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
          const p = speakerPalette(spkId)
          av.style.background = p.color
          av.textContent = speakerInitials(this._knownSpeakers[spkId] || spkId)
        }
        stack.appendChild(av)
      })
      metaEl.appendChild(stack)
    }

    btn.appendChild(metaEl)
    btn.addEventListener('click', () => this.showEditor(item.id))
    return btn
  },

  _setFilter(filter) {
    this._filter = filter
    document.querySelectorAll('.sb-filter-btn').forEach(btn => {
      btn.classList.toggle('sb-filter-btn--active', btn.dataset.filter === filter)
    })
    this._rerenderList()
  },

  // ── Init ────────────────────────────────────────────────────────────────────

  init() {
    loadSettings().then(() => this._loadSidebar({ autoOpen: true }))

    // ── Sidebar buttons ────────────────────────────────────────────────────────
    document.getElementById('btn-import')
      .addEventListener('click', () => this.openNewRecordingModal())

    document.getElementById('btn-settings')
      .addEventListener('click', () => this.showSettings())

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
