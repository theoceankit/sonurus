// ── New Recording Modal ──────────────────────────────────────────────────────
// Shown when the user clicks Record or +. Collects audio source, devices,
// model/language, and toggles before starting a live recording or importing
// audio files (dropped on it or picked in the file dialog, several at once).
// While a recording runs (`recording`) it only imports.
// Model and language start from the defaults in Settings; a choice made here
// applies to this recording or import only and is not saved. Without a default
// model or the diarization model (transcription-model.js) Start and Import are
// off and a notice links to Settings; models not downloaded cannot be picked.

function renderNewRecordingModal({ onStart, onImport, recording = false }) {
  // ── State ──────────────────────────────────────────────────────────────────

  let audioSource   = appSettings.recordingAudioSource || 'both'
  let micDeviceId   = appSettings.recordingMicDevice   || null
  let sysDeviceId   = appSettings.recordingSystemDevice || null
  let models        = modelState()                     // null until GET /models answered
  let modelValue    = models?.model ?? null
  let modelPicked   = false                              // chosen here, not the default
  let langValue     = appSettings.transcribeLang        || 'auto'
  // `diarize` is persisted but not sent to the backend; its toggle is marked
  // unimplemented (not-implemented.js).
  let diarize       = appSettings.recordingDiarize !== false

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
  closeBtn.innerHTML = icon('close', 11)
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
      icon: icon('microphone', 14),
    },
    {
      id: 'system',
      name: 'System audio',
      desc: 'Calls, browser, apps',
      icon: icon('system-audio', 14),
    },
    {
      id: 'both',
      name: 'Both',
      desc: 'Recommended for meetings',
      recommended: true,
      icon: icon('microphone-and-system', 14),
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

  const modelWrap = document.createElement('div')
  modelWrap.className = 'nr-field-dropdown-wrap'
  modelField.appendChild(modelFieldLabel)
  modelField.appendChild(modelWrap)

  function renderModelField() {
    if (!models || !models.model) {
      const empty = document.createElement('div')
      empty.className = 'nr-model-empty'
      empty.textContent = models ? 'No model installed' : 'Checking models…'
      modelWrap.replaceChildren(empty)
      return
    }
    const opts = models.models
      .filter(m => m.kind === 'whisper')
      .map(m => ({ value: m.id, label: m.name, disabled: !m.installed }))
    modelWrap.replaceChildren(makeDropdown(
      opts, modelValue,
      v => { modelValue = v; modelPicked = true },
      renderModelOption
    ))
  }

  const langField = document.createElement('div')
  langField.className = 'nr-field'
  const langFieldLabel = document.createElement('div')
  langFieldLabel.className = 'nr-field-label'
  langFieldLabel.textContent = 'Language'
  // Languages whose alignment model is not installed are disabled options; the
  // default one stays shown (and blocks Start / Import) until another is picked.
  const langWrap = document.createElement('div')
  langWrap.className = 'nr-field-dropdown-wrap'
  function renderLangField() {
    const opts = langOptions.map(l => ({
      ...l, disabled: !!(models && missingAlignmentModel(l.value, models.models)),
    }))
    langWrap.replaceChildren(makeDropdown(
      opts, langValue,
      v => { langValue = v; renderModels() },
      renderModelOption
    ))
  }
  langField.appendChild(langFieldLabel)
  langField.appendChild(langWrap)

  settingsRow.appendChild(modelField)
  settingsRow.appendChild(langField)
  body.appendChild(settingsRow)

  // Shown when new jobs cannot start (no default model / no diarization).
  const notice = document.createElement('div')
  notice.className = 'nr-model-notice'
  notice.style.display = 'none'
  body.appendChild(notice)

  function renderNotice() {
    const text = models && !models.model ? 'No transcription model installed.'
      : models && !models.diarizeInstalled ? 'Diarization model not installed.'
      : models && missingAlignmentModel(langValue, models.models)
        ? `Alignment model for ${languageLabel(langValue)} is not installed.`
      : null
    notice.style.display = text ? '' : 'none'
    if (!text) return
    const label = document.createElement('span')
    label.textContent = text
    const link = document.createElement('button')
    link.className = 'nr-model-notice-link'
    link.textContent = 'Download in Settings'
    link.addEventListener('click', () => { close(); app.showSettings() })
    notice.replaceChildren(label, link)
  }

  // ── Toggles ────────────────────────────────────────────────────────────────

  const togglesRow = document.createElement('div')
  togglesRow.className = 'nr-toggles'

  const TOGGLES = [
    { label: 'Diarize speakers', get: () => diarize,   set: v => { diarize = v },   notImplemented: 'recording.diarize' },
  ]

  TOGGLES.forEach(t => {
    const btn = document.createElement('button')
    btn.className = 'nr-toggle'

    function refresh() {
      const on = t.get()
      btn.classList.toggle('nr-toggle--on', on)
      btn.innerHTML = on
        ? `${icon('check', 10)}${t.label}`
        : `${icon('add', 11)}${t.label}`
    }
    refresh()
    btn.addEventListener('click', () => { t.set(!t.get()); refresh() })
    markNotImplemented(btn, t.notImplemented)
    togglesRow.appendChild(btn)
  })
  body.appendChild(togglesRow)

  // ── Footer ─────────────────────────────────────────────────────────────────

  const footer = document.createElement('div')
  footer.className = 'nr-modal-footer'

  const importBtn = document.createElement('button')
  importBtn.className = 'nr-import-btn'
  importBtn.innerHTML = `
    ${icon('import', 13)}Import audio file`
  importBtn.addEventListener('click', () => {
    if (importBtn.disabled) return
    window.electronAPI.openFiles().then(paths => {
      if (paths?.length) importPaths(paths)
    })
  })

  // Start and Import need the default model and the diarization model.
  function canRun() {
    return !!models && !jobBlockMessage(models, langValue)
  }

  // Several files are queued in order; see modalImportItems() for titles.
  function importPaths(paths) {
    if (!canRun()) {
      const message = models ? jobBlockMessage(models, langValue) : 'Checking models…'
      window.showToast?.(message, { actionLabel: 'Open Settings', action: () => { close(); app.showSettings() } })
      return
    }
    const { items, skipped } = modalImportItems(paths, {
      title: titleInput.value,
      titleIsDefault: titleInput.hasAttribute('data-default'),
    })
    if (skipped) window.showToast?.(skippedFilesToast(skipped))
    if (!items.length) return
    close()
    onImport({ items, model: modelValue, language: langValue })
  }

  const startBtn = document.createElement('button')
  startBtn.className = 'nr-start-btn'
  startBtn.textContent = 'Start recording'
  startBtn.addEventListener('click', () => {
    if (startBtn.disabled) return
    const settings = {
      audioSource,
      micDeviceId   : micDeviceId === '__default__' ? null : micDeviceId,
      systemDeviceId: sysDeviceId === '__default__' ? null : sysDeviceId,
      title  : titleInput.value.trim() || null,
      model  : modelValue,
      language: langValue,
      diarize,
    }
    saveSettings({
      recordingAudioSource  : audioSource,
      recordingMicDevice    : settings.micDeviceId,
      recordingSystemDevice : settings.systemDeviceId,
      recordingDiarize      : diarize,
    })
    close()
    onStart(settings)
  })

  footer.appendChild(importBtn)
  footer.appendChild(startBtn)
  modal.appendChild(footer)

  function renderModels() {
    renderModelField()
    renderLangField()
    renderNotice()
    const blocked = canRun() ? '' : models ? jobBlockMessage(models, langValue) : 'Checking models…'
    importBtn.disabled = !!blocked
    importBtn.title = blocked
    startBtn.disabled = recording || !!blocked
    startBtn.title = recording ? 'A recording is already in progress' : blocked
  }

  // From the last known catalog at once, then from a fresh GET /models (which
  // also re-resolves the default). A model picked here stays if still installed.
  renderModels()
  syncTranscribeModel().then(fresh => {
    if (!fresh) return
    const picked = modelPicked && installedWhisperModels(fresh.models).includes(modelValue)
    models = fresh
    if (!picked) { modelValue = fresh.model; modelPicked = false }
    renderModels()
  })

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

      const sysOptions = await listSystemAudioSources(platform, inputs)

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
    ${icon('import', 28)}
    <span>Drop audio files to transcribe</span>`
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
    const paths = Array.from(e.dataTransfer.files)
      .map(file => window.electronAPI.getFilePath(file))
      .filter(Boolean)
    if (paths.length) importPaths(paths)
  })

  // ── Init ───────────────────────────────────────────────────────────────────

  populateDevices()
  updateDeviceVisibility()

  return overlay
}
