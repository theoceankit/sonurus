// ── New Recording Modal ──────────────────────────────────────────────────────
// Shown when the user clicks Record or +. Collects audio source, devices,
// model/language, and toggles before starting a live recording or importing
// an audio file.

function renderNewRecordingModal({ onStart, onImport }) {
  // ── State ──────────────────────────────────────────────────────────────────

  let audioSource   = appSettings.recordingAudioSource || 'both'
  let micDeviceId   = appSettings.recordingMicDevice   || null
  let sysDeviceId   = appSettings.recordingSystemDevice || null
  let modelValue    = appSettings.transcribeModel       || 'large-v3'
  let langValue     = appSettings.transcribeLang        || 'auto'
  let diarize       = appSettings.recordingDiarize !== false
  let saveAudio     = appSettings.recordingSaveAudio    !== false

  // ── Overlay + card ─────────────────────────────────────────────────────────

  const overlay = document.createElement('div')
  overlay.className = 'nr-overlay'

  const modal = document.createElement('div')
  modal.className = 'nr-modal'
  overlay.appendChild(modal)

  function close() { overlay.remove() }
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close() })
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc) }
  })

  // ── Header ─────────────────────────────────────────────────────────────────

  const now = new Date()
  const pad2 = n => String(n).padStart(2, '0')
  const timeStr = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const dateStr = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${timeStr}`

  const header = document.createElement('div')
  header.className = 'nr-modal-header'
  header.innerHTML = `
    <div class="nr-modal-icon">
      <span class="nr-modal-rec-dot"></span>
    </div>
    <div class="nr-modal-titles">
      <span class="nr-modal-title">New recording</span>
      <span class="nr-modal-subtitle">${dateStr}</span>
    </div>
  `

  const closeBtn = document.createElement('button')
  closeBtn.className = 'nr-modal-close'
  closeBtn.title = 'Close'
  closeBtn.innerHTML = `<svg width="9" height="9" viewBox="0 0 9 9" fill="none">
    <path d="M1 1l7 7M8 1l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`
  closeBtn.addEventListener('click', close)
  header.appendChild(closeBtn)
  modal.appendChild(header)

  // ── Body ───────────────────────────────────────────────────────────────────

  const body = document.createElement('div')
  body.className = 'nr-modal-body'
  modal.appendChild(body)

  // Title input
  const titleInput = document.createElement('input')
  titleInput.type = 'text'
  titleInput.className = 'nr-title-input'
  titleInput.placeholder = 'Untitled meeting'
  titleInput.value = `${now.getDate()} ${MONTHS[now.getMonth()]} ${timeStr} Meeting`
  body.appendChild(titleInput)

  // ── Audio source ────────────────────────────────────────────────────────────

  const audioSection = document.createElement('div')
  audioSection.className = 'nr-section'

  const audioSectionLabel = document.createElement('div')
  audioSectionLabel.className = 'nr-section-label'
  audioSectionLabel.textContent = 'Audio source'
  audioSection.appendChild(audioSectionLabel)

  const audioGrid = document.createElement('div')
  audioGrid.className = 'nr-audio-source'

  const AUDIO_OPTS = [
    {
      id: 'mic',
      name: 'Microphone',
      desc: 'Just your voice',
      icon: `<svg width="14" height="14" viewBox="0 0 18 18" fill="none">
        <path d="M9 2a3 3 0 013 3v4a3 3 0 01-6 0V5a3 3 0 013-3z" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <path d="M4 9a5 5 0 0010 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="9" y1="14" x2="9" y2="16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`,
    },
    {
      id: 'system',
      name: 'System audio',
      desc: 'Calls, browser, apps',
      icon: `<svg width="14" height="14" viewBox="0 0 18 18" fill="none">
        <rect x="1.5" y="3" width="15" height="9.5" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <path d="M6 12.5v2M12 12.5v2M4 14.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`,
    },
    {
      id: 'both',
      name: 'Both',
      desc: 'Recommended for meetings',
      recommended: true,
      icon: `<svg width="14" height="14" viewBox="0 0 18 18" fill="none">
        <path d="M6.5 2.5a2.5 2.5 0 015 0V7a2.5 2.5 0 01-5 0V2.5z" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <path d="M3 7a6 6 0 0012 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <rect x="11" y="5" width="5.5" height="4" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
      </svg>`,
    },
  ]

  const audioOptBtns = []
  AUDIO_OPTS.forEach(opt => {
    const btn = document.createElement('button')
    btn.className = 'nr-audio-opt' + (audioSource === opt.id ? ' nr-audio-opt--active' : '')
    btn.innerHTML = `
      <div class="nr-audio-opt-icon">${opt.icon}</div>
      <div class="nr-audio-opt-name">${opt.name}</div>
      <div class="nr-audio-opt-desc">${opt.desc}</div>
      ${opt.recommended ? '<span class="nr-badge-recommended">Recommended</span>' : ''}
    `
    btn.addEventListener('click', () => {
      audioSource = opt.id
      audioOptBtns.forEach((b, i) => {
        b.classList.toggle('nr-audio-opt--active', AUDIO_OPTS[i].id === audioSource)
      })
      updateDeviceVisibility()
    })
    audioOptBtns.push(btn)
    audioGrid.appendChild(btn)
  })
  audioSection.appendChild(audioGrid)
  body.appendChild(audioSection)

  // ── Device dropdowns ───────────────────────────────────────────────────────

  const devRow = document.createElement('div')
  devRow.className = 'nr-fields-row'

  const micField = makeDeviceField('Input device')
  const sysField = makeDeviceField('System audio')
  devRow.appendChild(micField.el)
  devRow.appendChild(sysField.el)
  body.appendChild(devRow)

  function makeDeviceField(label) {
    const el = document.createElement('div')
    el.className = 'nr-field'
    const lbl = document.createElement('div')
    lbl.className = 'nr-field-label'
    lbl.textContent = label
    const wrap = document.createElement('div')
    wrap.className = 'nr-field-dropdown-wrap'
    el.appendChild(lbl)
    el.appendChild(wrap)
    return { el, wrap }
  }

  // ── Model + Language ───────────────────────────────────────────────────────

  const settingsRow = document.createElement('div')
  settingsRow.className = 'nr-fields-row'

  const modelOptions = MODELS
    .filter(m => m.kind === 'whisper')
    .map(m => ({ value: m.id, label: m.name, sub: `${m.size} · ${m.speed}` }))

  const langOptions = LANGUAGES.map(l => ({ ...l, value: l.code }))

  const modelField = document.createElement('div')
  modelField.className = 'nr-field'
  const modelFieldLabel = document.createElement('div')
  modelFieldLabel.className = 'nr-field-label'
  modelFieldLabel.textContent = 'Model'
  const modelDropdown = makeDropdown(
    modelOptions, modelValue,
    v => { modelValue = v; saveSettings({ transcribeModel: v }) },
    (opt) => { const s = document.createElement('span'); s.textContent = opt.label; return s }
  )
  modelField.appendChild(modelFieldLabel)
  modelField.appendChild(modelDropdown)

  const langField = document.createElement('div')
  langField.className = 'nr-field'
  const langFieldLabel = document.createElement('div')
  langFieldLabel.className = 'nr-field-label'
  langFieldLabel.textContent = 'Language'
  const langDropdown = makeDropdown(
    langOptions, langValue,
    v => { langValue = v; saveSettings({ transcribeLang: v }) },
    (opt, isTrigger) => {
      const s = document.createElement('span')
      s.style.cssText = 'display:inline-flex;align-items:center;gap:8px'
      s.innerHTML = `<span>${opt.flag}</span><span>${opt.label}</span>`
      return s
    }
  )
  langField.appendChild(langFieldLabel)
  langField.appendChild(langDropdown)

  settingsRow.appendChild(modelField)
  settingsRow.appendChild(langField)
  body.appendChild(settingsRow)

  // ── Toggles ────────────────────────────────────────────────────────────────

  const togglesRow = document.createElement('div')
  togglesRow.className = 'nr-toggles'

  const TOGGLES = [
    { label: 'Diarize speakers', get: () => diarize,   set: v => { diarize = v } },
    { label: 'Save audio file',  get: () => saveAudio, set: v => { saveAudio = v } },
  ]

  TOGGLES.forEach(t => {
    const btn = document.createElement('button')
    btn.className = 'nr-toggle'

    function refresh() {
      const on = t.get()
      btn.classList.toggle('nr-toggle--on', on)
      btn.innerHTML = on
        ? `<svg width="10" height="8" viewBox="0 0 11 9" fill="none">
             <path d="M1 4.5l3 3 6-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
           </svg>${t.label}`
        : `<svg width="9" height="9" viewBox="0 0 9 9" fill="none">
             <path d="M4.5 1v7M1 4.5h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
           </svg>${t.label}`
    }
    refresh()
    btn.addEventListener('click', () => { t.set(!t.get()); refresh() })
    togglesRow.appendChild(btn)
  })
  body.appendChild(togglesRow)

  // ── Footer ─────────────────────────────────────────────────────────────────

  const footer = document.createElement('div')
  footer.className = 'nr-modal-footer'

  const importBtn = document.createElement('button')
  importBtn.className = 'nr-import-btn'
  importBtn.innerHTML = `
    <svg width="12" height="13" viewBox="0 0 14 15" fill="none">
      <path d="M7 1.5v9M3.5 7l3.5 4 3.5-4M2 13.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>Import audio file`
  importBtn.addEventListener('click', () => {
    window.electronAPI.openFile().then(filePath => {
      if (!filePath) return
      close()
      onImport({
        filePath,
        title: titleInput.value.trim() || null,
        model: modelValue,
        language: langValue,
      })
    })
  })

  const startBtn = document.createElement('button')
  startBtn.className = 'nr-start-btn'
  startBtn.innerHTML = `
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
      <circle cx="4" cy="4" r="4" fill="#FF453A"/>
    </svg>Start recording`
  startBtn.addEventListener('click', () => {
    const settings = {
      audioSource,
      micDeviceId   : micDeviceId === '__default__' ? null : micDeviceId,
      systemDeviceId: sysDeviceId === '__default__' ? null : sysDeviceId,
      title  : titleInput.value.trim() || null,
      model  : modelValue,
      language: langValue,
      diarize,
      saveAudio,
    }
    saveSettings({
      recordingAudioSource  : audioSource,
      recordingMicDevice    : settings.micDeviceId,
      recordingSystemDevice : settings.systemDeviceId,
      recordingDiarize      : diarize,
      recordingSaveAudio    : saveAudio,
    })
    close()
    onStart(settings)
  })

  footer.appendChild(importBtn)
  footer.appendChild(startBtn)
  modal.appendChild(footer)

  // ── Populate device dropdowns async ────────────────────────────────────────

  async function populateDevices() {
    try {
      // Request permission so labels are populated
      await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {})
      const devices = await navigator.mediaDevices.enumerateDevices()
      const inputs  = devices.filter(d => d.kind === 'audioinput')

      const micOptions = [
        { value: '__default__', label: 'Default microphone' },
        ...inputs.map(d => ({
          value: d.deviceId,
          label: d.label || `Microphone ${d.deviceId.slice(0, 6)}`,
        })),
      ]

      // System audio candidates: virtual/loopback/output/system audio devices
      const sysMatches = inputs.filter(d =>
        /virtual|loopback|system|output|mix/i.test(d.label)
      )
      const sysOptions = [
        { value: '__default__', label: sysMatches.length ? 'Auto-detect' : 'Not available' },
        ...sysMatches.map(d => ({ value: d.deviceId, label: d.label })),
      ]

      const micDd = makeDropdown(
        micOptions,
        micDeviceId || '__default__',
        v => { micDeviceId = v },
        opt => { const s = document.createElement('span'); s.textContent = opt.label; return s }
      )
      micField.wrap.innerHTML = ''
      micField.wrap.appendChild(micDd)

      const sysDd = makeDropdown(
        sysOptions,
        sysDeviceId || '__default__',
        v => { sysDeviceId = v },
        opt => { const s = document.createElement('span'); s.textContent = opt.label; return s }
      )
      sysField.wrap.innerHTML = ''
      sysField.wrap.appendChild(sysDd)
    } catch (_) {}
  }

  function updateDeviceVisibility() {
    devRow.style.display = ''
    micField.el.style.display  = (audioSource === 'system') ? 'none' : ''
    sysField.el.style.display  = (audioSource === 'mic')    ? 'none' : ''
    // Hide entire row when only one source and the other is hidden
    if (audioSource === 'mic' || audioSource === 'system') {
      micField.el.style.gridColumn = ''
      sysField.el.style.gridColumn = ''
      if (audioSource === 'mic')    micField.el.style.gridColumn = '1 / -1'
      if (audioSource === 'system') sysField.el.style.gridColumn = '1 / -1'
    } else {
      micField.el.style.gridColumn = ''
      sysField.el.style.gridColumn = ''
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  populateDevices()
  updateDeviceVisibility()

  return overlay
}
