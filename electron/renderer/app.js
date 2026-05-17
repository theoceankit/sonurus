
// ── Settings (persisted to disk via IPC) ────────────────────────────────────
const appSettings = {
  scale: 100,
  transcribeLang: 'auto',
  transcribeModel: 'small',
  exportFormat: 'txt',
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

  // ── Navigation ──────────────────────────────────────────────────────────────

  _setView(el, editorMode = false) {
    const panel = document.getElementById('main-panel')
    panel.innerHTML = ''
    panel.classList.toggle('main-panel--editor', editorMode)
    panel.appendChild(el)
  },

  showImport() {
    this._activeTranscriptId = null
    this._rerenderList()
    this._setView(renderImportView(), false)
    document.getElementById('btn-import').classList.add('sb-new-btn--active')
  },

  showProgress(jobId) {
    document.getElementById('btn-import').classList.remove('sb-new-btn--active')
    this._setView(renderProgressView(jobId), false)
  },

  showSettings() {
    this._activeTranscriptId = null
    document.getElementById('btn-import').classList.remove('sb-new-btn--active')
    this._rerenderList()
    this._setView(renderSettingsView(), false)
  },

  showEditor(transcriptId) {
    this._activeTranscriptId = transcriptId
    document.getElementById('btn-import').classList.remove('sb-new-btn--active')
    this._rerenderList()
    this._setView(renderEditorView(transcriptId), true)
    this._loadSidebar()
  },

  // ── Sidebar ─────────────────────────────────────────────────────────────────

  navTo(id) {
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('nav-item--active', el.id === 'nav-' + id)
    })
    // Speakers and Bookmarks are stubs for now — just deselect transcript
    if (id === 'transcripts') {
      // nothing extra — recordings list is always visible
    }
  },

  _loadSidebar() {
    Promise.all([
      fetch(`${API_BASE}/transcripts`).then(r => r.json()),
      fetch(`${API_BASE}/speakers`).then(r => r.json()),
    ]).then(([items, speakers]) => {
      this._allRecordings = items
      this._knownSpeakers = {}
      speakers.forEach(s => { this._knownSpeakers[s.id] = s.name })
      this._rerenderList()
      const countTranscripts = document.getElementById('nav-count-transcripts')
      if (countTranscripts) countTranscripts.textContent = items.length || ''
      const countSpeakers = document.getElementById('nav-count-speakers')
      if (countSpeakers) countSpeakers.textContent = speakers.length || ''
    }).catch(() => {})
  },

  _rerenderList(query = '') {
    const list = document.getElementById('recordings-list')
    if (!list) return

    const items = query
      ? this._allRecordings.filter(r => r.title.toLowerCase().includes(query.toLowerCase()))
      : this._allRecordings

    list.innerHTML = ''

    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'sb-empty'
      empty.textContent = query ? 'No results' : 'No recordings yet'
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
    const btn = document.createElement('button')
    btn.className = 'rec-item'
    if (item.id === this._activeTranscriptId) btn.classList.add('rec-item--active')

    // Title row
    const titleRow = document.createElement('div')
    titleRow.className = 'rec-item-title'
    titleRow.textContent = item.title

    // Bottom row: avatars + time + duration
    const bottomRow = document.createElement('div')
    bottomRow.className = 'rec-item-bottom'

    // Stacked speaker avatars
    const avatarStack = document.createElement('div')
    avatarStack.className = 'rec-avatars'
    const speakers = (item.speakers || []).filter(Boolean).slice(0, 4)
    speakers.forEach((spkId, i) => {
      const av = document.createElement('div')
      av.className = 'rec-avatar'
      av.style.marginLeft = i === 0 ? '0' : '-5px'

      if (isUnrecognized(spkId, this._knownSpeakers)) {
        av.style.background = 'repeating-linear-gradient(135deg,#FBF1DF 0 3px,#F6E6C8 3px 6px)'
        av.style.border = '1px dashed #B58A3A'
        av.style.color = '#8A6320'
        av.textContent = '?'
      } else {
        const p = speakerPalette(spkId)
        av.style.background = p.color
        const name = this._knownSpeakers[spkId] || spkId
        av.textContent = speakerInitials(name)
      }
      avatarStack.appendChild(av)
    })

    const spacer = document.createElement('span')
    spacer.style.flex = '1'

    const dur = document.createElement('span')
    dur.className = 'rec-item-dur'
    dur.textContent = item.duration || ''

    bottomRow.appendChild(avatarStack)
    bottomRow.appendChild(spacer)
    bottomRow.appendChild(dur)

    btn.appendChild(titleRow)
    btn.appendChild(bottomRow)
    btn.addEventListener('click', () => this.showEditor(item.id))
    return btn
  },

  // ── Init ────────────────────────────────────────────────────────────────────

  init() {
    loadSettings().then(() => this._loadSidebar())
    this.showImport()

    document.getElementById('btn-import')
      .addEventListener('click', () => this.showImport())

    document.getElementById('btn-settings')
      .addEventListener('click', () => this.showSettings())

    document.getElementById('nav-transcripts')
      .addEventListener('click', () => this.navTo('transcripts'))
    document.getElementById('nav-speakers')
      .addEventListener('click', () => this.navTo('speakers'))
    document.getElementById('nav-bookmarks')
      .addEventListener('click', () => this.navTo('bookmarks'))

    document.getElementById('sb-search-input')
      .addEventListener('input', e => this._rerenderList(e.target.value))
  },
}

app.init()
