
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

  // ── Navigation ──────────────────────────────────────────────────────────────

  _setView(el, editorMode = false) {
    const panel = document.getElementById('main-panel')
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

  showImport() {
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

  showLiveRecording(settings = {}) {
    this._currentView = 'live'
    this._activeTranscriptId = null
    document.getElementById('btn-import').classList.remove('sb-new-btn--active')
    this._rerenderList()
    this._setView(renderLiveRecordingView(settings), false)
  },

  openNewRecordingModal() {
    const overlay = renderNewRecordingModal({
      onStart: settings => this.showLiveRecording(settings),
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
        else { this.showImport(); this.openNewRecordingModal() }
      }
    }).catch(() => { if (autoOpen) { this.showImport(); this.openNewRecordingModal() } })
  },

  _applyFilter(items) {
    if (this._filter === 'recordings') return items.filter(r => r.source !== 'note')
    if (this._filter === 'notes')      return items.filter(r => r.source === 'note')
    if (this._filter === 'marked')     return items.filter(r => r.bookmarked)
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

    let lastSection = null
    items.forEach(item => {
      if (item.section !== lastSection) {
        lastSection = item.section
        const lbl = document.createElement('div')
        lbl.className = 'sb-group-label'
        lbl.textContent = item.section
        list.appendChild(lbl)
      }
      list.appendChild(this._makeRecordingItem(item))
    })
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

    // ── Toast system ───────────────────────────────────────────────────────────
    const _toastStack = document.createElement('div')
    _toastStack.id = 'toast-stack'
    document.body.appendChild(_toastStack)

    window.showToast = function(text, opts = {}) {
      const { actionLabel, action, duration = 3200 } = opts
      const toast = document.createElement('div')
      toast.className = 'toast'

      const msg = document.createElement('span')
      msg.className = 'toast-text'
      msg.textContent = text
      toast.appendChild(msg)

      if (actionLabel) {
        const btn = document.createElement('button')
        btn.className = 'toast-action'
        btn.textContent = actionLabel
        btn.addEventListener('click', () => { action?.(); dismiss() })
        toast.appendChild(btn)
      }

      const closeBtn = document.createElement('button')
      closeBtn.className = 'toast-close'
      closeBtn.textContent = '✕'
      closeBtn.addEventListener('click', dismiss)
      toast.appendChild(closeBtn)

      _toastStack.appendChild(toast)
      requestAnimationFrame(() => toast.classList.add('toast--visible'))

      let timer = setTimeout(dismiss, duration)

      function dismiss() {
        clearTimeout(timer)
        toast.classList.remove('toast--visible')
        toast.classList.add('toast--out')
        setTimeout(() => toast.remove(), 220)
      }

      return { dismiss }
    }

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
      .addEventListener('click', () => { if (this._currentView !== 'import') this.showImport() })

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



    // ── Titlebar — search ──────────────────────────────────────────────────────
    document.getElementById('tb-search-btn')
      .addEventListener('click', () => document.getElementById('sb-search-input')?.focus())

    // ── Titlebar — record ──────────────────────────────────────────────────────
    document.getElementById('tb-record')
      .addEventListener('click', () => this.openNewRecordingModal())

    // ── Titlebar — panels ──────────────────────────────────────────────────────
    document.getElementById('tb-inspector-toggle')
      .addEventListener('click', () => this.toggleInspector())
  },
}

app.init()
