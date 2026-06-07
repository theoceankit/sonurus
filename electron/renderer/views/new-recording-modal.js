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

  function onEsc(e) { if (e.key === 'Escape') close() }
  function close() {
    document.removeEventListener('keydown', onEsc)
    overlay.remove()
  }
  document.addEventListener('keydown', onEsc)

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
      <span class="nr-modal-subtitle">Make sure all participants have agreed to be recorded.</span>
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

  // Title input — shows default value in gray; turns dark on first edit
  const titleInput = document.createElement('input')
  titleInput.type = 'text'
  titleInput.className = 'nr-title-input'
  titleInput.placeholder = 'Untitled meeting'
  titleInput.value = `${now.getDate()} ${MONTHS[now.getMonth()]} ${timeStr} Meeting`
  titleInput.setAttribute('data-default', '')
  titleInput.addEventListener('beforeinput', () => {
    if (titleInput.hasAttribute('data-default')) {
      titleInput.value = ''
      titleInput.removeAttribute('data-default')
    }
  })
  titleInput.addEventListener('focus', () => {
    if (titleInput.hasAttribute('data-default')) setTimeout(() => titleInput.setSelectionRange(0, 0), 0)
  })
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

  const langOptions = LANGUAGES.map(l => ({ ...l, value: l.code }))

  const modelField = document.createElement('div')
  modelField.className = 'nr-field'
  const modelFieldLabel = document.createElement('div')
  modelFieldLabel.className = 'nr-field-label'
  modelFieldLabel.textContent = 'Model'

  // Build dropdown from static list first; replace with live data once fetched.
  function buildModelDropdown(models) {
    const opts = models
      .filter(m => m.kind === 'whisper')
      .map(m => ({
        value: m.id, label: m.name,
        sub: m.installed ? `${m.size} · Installed` : `${m.size} · ${m.speed}`,
      }))
    return makeDropdown(
      opts, modelValue,
      v => { modelValue = v; saveSettings({ transcribeModel: v }) },
      (opt) => { const s = document.createElement('span'); s.textContent = opt.label; return s }
    )
  }

  let modelDropdown = buildModelDropdown(MODELS)
  modelField.appendChild(modelFieldLabel)
  modelField.appendChild(modelDropdown)

  // Async: update dropdown with live install status from the server.
  fetch(`${API_BASE}/models`)
    .then(r => r.json())
    .then(liveModels => {
      const updated = buildModelDropdown(liveModels)
      modelDropdown.replaceWith(updated)
      modelDropdown = updated
    })
    .catch(() => { /* keep static dropdown on network error */ })

  const langField = document.createElement('div')
  langField.className = 'nr-field'
  const langFieldLabel = document.createElement('div')
  langFieldLabel.className = 'nr-field-label'
  langFieldLabel.textContent = 'Language'
  const langDropdown = makeDropdown(
    langOptions, langValue,
    v => { langValue = v; saveSettings({ transcribeLang: v }) },
    (opt) => {
      const s = document.createElement('span')
      s.textContent = opt.label
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
  startBtn.textContent = 'Start recording'
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
      const platform = await window.electronAPI.getPlatform()

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

      const sysOptions = []

      if (platform === 'win32') {
        // Windows: WASAPI loopback via Electron's setDisplayMediaRequestHandler
        sysOptions.push({ value: '__desktop__', label: 'System audio (WASAPI)' })
        // Surface any browser-visible loopback devices as well
        inputs
          .filter(d => /virtual|loopback|system|output|mix|monitor/i.test(d.label))
          .forEach(d => sysOptions.push({ value: d.deviceId, label: d.label }))
      } else {
        // macOS: ScreenCaptureKit via backend AudioCaptureService
        // Linux: PipeWire/PulseAudio monitor sources via backend AudioCaptureService
        try {
          const r = await fetch(`${API_BASE}/audio/capture/sources`)
          if (r.ok) {
            const { sources } = await r.json()
            sources.forEach(s => sysOptions.push({ value: s.id, label: s.label }))
          }
        } catch (_) {}
      }

      if (!sysOptions.length) {
        sysOptions.push({ value: '__default__', label: 'Not available' })
      }

      const micDd = makeDropdown(
        micOptions,
        micDeviceId || '__default__',
        v => { micDeviceId = v },
        opt => { const s = document.createElement('span'); s.textContent = opt.label; return s }
      )
      micField.wrap.innerHTML = ''
      micField.wrap.appendChild(micDd)

      // Restore saved system device, but fall back to first available option
      const savedSysId = sysDeviceId && sysOptions.some(o => o.value === sysDeviceId)
        ? sysDeviceId
        : sysOptions[0].value
      sysDeviceId = savedSysId

      const sysDd = makeDropdown(
        sysOptions,
        savedSysId,
        v => { sysDeviceId = v },
        opt => { const s = document.createElement('span'); s.textContent = opt.label; return s }
      )
      sysField.wrap.innerHTML = ''
      sysField.wrap.appendChild(sysDd)
    } catch (_) {}
  }

  function updateDeviceVisibility() {
    const micDisabled = audioSource === 'system'
    const sysDisabled = audioSource === 'mic'
    micField.el.classList.toggle('nr-field--disabled', micDisabled)
    sysField.el.classList.toggle('nr-field--disabled', sysDisabled)
    micField.el.querySelectorAll('select, button, input').forEach(el => el.disabled = micDisabled)
    sysField.el.querySelectorAll('select, button, input').forEach(el => el.disabled = sysDisabled)
  }

  // ── Drag & drop ────────────────────────────────────────────────────────────

  const dropOverlay = document.createElement('div')
  dropOverlay.className = 'nr-drop-overlay'
  dropOverlay.innerHTML = `
    <svg class="nr-drop-border" aria-hidden="true">
      <rect width="100%" height="100%" rx="14" ry="14" fill="none"
        stroke="#0A84FF" stroke-width="3" stroke-dasharray="18,10" stroke-linecap="round"/>
    </svg>
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <path d="M14 4v14M7 11l7 8 7-8M5 23h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>Drop audio file to transcribe</span>`
  modal.appendChild(dropOverlay)

  let dragCounter = 0

  modal.addEventListener('dragenter', e => {
    e.preventDefault()
    dragCounter++
    if (dragCounter === 1) dropOverlay.classList.add('nr-drop-overlay--active')
  })
  modal.addEventListener('dragleave', () => {
    dragCounter--
    if (dragCounter === 0) dropOverlay.classList.remove('nr-drop-overlay--active')
  })
  modal.addEventListener('dragover', e => e.preventDefault())
  modal.addEventListener('drop', e => {
    e.preventDefault()
    dragCounter = 0
    dropOverlay.classList.remove('nr-drop-overlay--active')
    const file = e.dataTransfer.files[0]
    if (!file) return
    const filePath = window.electronAPI.getFilePath(file)
    if (!filePath) return
    const title = titleInput.hasAttribute('data-default')
      ? file.name.replace(/\.[^.]+$/, '')
      : titleInput.value.trim() || null
    close()
    onImport({ filePath, title, model: modelValue, language: langValue })
  })

  // ── Init ───────────────────────────────────────────────────────────────────

  populateDevices()
  updateDeviceVisibility()

  return overlay
}
