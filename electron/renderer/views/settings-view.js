// ── Static data ────────────────────────────────────────────────────────────────
// LANGUAGES and MODELS are loaded from data.js

// TODO(not implemented): export format and include-* / duplicate options are
// UI only — the titlebar export always copies plain text. See roadmap
// "UI without business logic".
const ST_EXPORT_FORMATS = [
  { id: 'txt',  label: 'Plain text', ext: '.txt',  desc: 'No formatting, raw transcript' },
  { id: 'md',   label: 'Markdown',   ext: '.md',   desc: 'Speakers as headers, timestamps inline' },
  { id: 'srt',  label: 'SubRip',     ext: '.srt',  desc: 'Subtitles with timing' },
  { id: 'vtt',  label: 'WebVTT',     ext: '.vtt',  desc: 'Web subtitles' },
  { id: 'json', label: 'JSON',       ext: '.json', desc: 'Full structured data' },
]

// ── State ──────────────────────────────────────────────────────────────────────

function makeSettings() {
  const modelStatus = {}
  ALIGNMENT_MODELS.forEach(m => { modelStatus[m.id] = 'available' })
  return {
    transcribeLang: appSettings.transcribeLang,
    transcribeModel: appSettings.transcribeModel,
    scale: appSettings.scale,
    exportFormat: appSettings.exportFormat,
    recordingMicDevice: appSettings.recordingMicDevice ?? null,
    recordingSystemDevice: appSettings.recordingSystemDevice ?? null,
    recordingUseMic: appSettings.recordingUseMic ?? true,
    hfToken: appSettings.hfToken ?? '',
    duplicate: true,
    incTimestamps: true,
    incSpeakers: true,
    incBookmarks: false,
    incAudio: false,
    modelStatus,
    activeDownload: {},
    modelProgress: {},
  }
}

// ── Primitives ─────────────────────────────────────────────────────────────────

function makeToggle(on, onChange) {
  const btn = document.createElement('button')
  btn.className = 'st-toggle' + (on ? ' st-toggle--on' : '')
  const knob = document.createElement('span')
  knob.className = 'st-toggle-knob'
  btn.appendChild(knob)
  btn.addEventListener('click', () => {
    const next = !btn.classList.contains('st-toggle--on')
    btn.classList.toggle('st-toggle--on', next)
    onChange(next)
  })
  return btn
}

function makePill(label, tone) {
  const el = document.createElement('span')
  el.className = `st-pill st-pill--${tone}`
  el.textContent = label
  return el
}

function makeSectionHeader(iconHtml, label, sub) {
  const wrap = document.createElement('div')
  wrap.className = 'st-section-header'

  const icon = document.createElement('div')
  icon.className = 'st-section-icon'
  icon.innerHTML = iconHtml

  const text = document.createElement('div')
  const t = document.createElement('div')
  t.className = 'st-section-title'
  t.textContent = label
  const s = document.createElement('div')
  s.className = 'st-section-sub'
  s.textContent = sub
  text.appendChild(t)
  text.appendChild(s)

  wrap.appendChild(icon)
  wrap.appendChild(text)
  return wrap
}

function makeFieldRow(labelText, hintText, control, last = false) {
  const row = document.createElement('div')
  row.className = 'st-field-row' + (last ? ' st-field-row--last' : '')

  const left = document.createElement('div')
  const lbl = document.createElement('div')
  lbl.className = 'st-field-label'
  lbl.textContent = labelText
  left.appendChild(lbl)
  if (hintText) {
    const hint = document.createElement('div')
    hint.className = 'st-field-hint'
    hint.textContent = hintText
    left.appendChild(hint)
  }

  const right = document.createElement('div')
  right.className = 'st-field-control'
  right.appendChild(control)

  row.appendChild(left)
  row.appendChild(right)
  return row
}

function makeSectionCard(children) {
  const card = document.createElement('div')
  card.className = 'st-card'
  children.forEach(c => card.appendChild(c))
  return card
}

// ── Dropdown ───────────────────────────────────────────────────────────────────
// makeDropdown is defined in components.js

function makeLangDropdown(options, value, onChange) {
  return makeDropdown(options, value, onChange, (opt, isValue) => {
    const row = document.createElement('span')
    row.style.cssText = 'display:inline-flex;align-items:center;gap:9px;width:100%'
    const flag = document.createElement('span')
    flag.style.fontSize = isValue ? '16px' : '17px'
    flag.textContent = opt.flag
    const label = document.createElement('span')
    label.textContent = opt.label
    label.style.flex = '1'
    row.appendChild(flag)
    row.appendChild(label)
    if (!isValue && opt.sub) {
      const sub = document.createElement('span')
      sub.style.cssText = 'font-size:11.5px;color:rgba(25,24,42,0.4)'
      sub.textContent = opt.sub
      row.appendChild(sub)
    }
    return row
  })
}

// ── Slider ─────────────────────────────────────────────────────────────────────

function makeSlider(value, min, max, step, marks, onChange, onCommit) {
  const wrap = document.createElement('div')
  wrap.className = 'st-slider-wrap'

  const track = document.createElement('div')
  track.className = 'st-slider-track'
  const fill = document.createElement('div')
  fill.className = 'st-slider-fill'
  const thumb = document.createElement('div')
  thumb.className = 'st-slider-thumb'
  track.appendChild(fill)
  track.appendChild(thumb)

  const markRow = document.createElement('div')
  markRow.className = 'st-slider-marks'

  const valBadge = document.createElement('div')
  valBadge.className = 'st-slider-badge'

  let current = value

  function render(v) {
    const pct = (v - min) / (max - min) * 100
    fill.style.width = pct + '%'
    thumb.style.left = pct + '%'
    valBadge.textContent = v + '%'
    if (marks) {
      markRow.querySelectorAll('.st-slider-mark').forEach(m => {
        m.classList.toggle('st-slider-mark--active', parseInt(m.dataset.val) === v)
      })
    }
  }

  function setFromX(clientX) {
    const r = track.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    const raw = min + pct * (max - min)
    const snapped = Math.round(raw / step) * step
    current = Math.max(min, Math.min(max, snapped))
    render(current)
    onChange(current)
  }

  let dragging = false
  track.addEventListener('mousedown', e => {
    dragging = true
    setFromX(e.clientX)
    const onMove = e => { if (dragging) setFromX(e.clientX) }
    const onUp = () => { dragging = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); if (onCommit) onCommit(current) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  })

  if (marks) {
    marks.forEach(m => {
      const lbl = document.createElement('span')
      lbl.className = 'st-slider-mark'
      lbl.dataset.val = m.value
      lbl.textContent = m.label
      lbl.style.left = ((m.value - min) / (max - min) * 100) + '%'
      markRow.appendChild(lbl)
    })
  }

  render(value)

  const row = document.createElement('div')
  row.style.cssText = 'display:flex;align-items:center;gap:19px'
  const sliderCol = document.createElement('div')
  sliderCol.appendChild(track)
  if (marks) sliderCol.appendChild(markRow)
  row.appendChild(sliderCol)
  row.appendChild(valBadge)
  wrap.appendChild(row)
  return wrap
}

// ── Shared download/delete handlers ───────────────────────────────────────────

function _makeDownloadHandler(state, rerenderRows) {
  return function onDownload(id) {
    state.modelStatus[id] = 'downloading'
    if (!state.modelProgress) state.modelProgress = {}
    state.modelProgress[id] = 0
    rerenderRows()

    fetch(`${API_BASE}/models/${id}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hf_token: state.hfToken || null }),
    })
      .then(r => r.json())
      .then(({ job_id }) => {
        const ws = new WebSocket(`${WS_BASE}/ws/models/${job_id}`)
        if (!state.activeDownload) state.activeDownload = {}
        state.activeDownload[id] = { job_id, ws }

        ws.onmessage = ({ data }) => {
          const ev = JSON.parse(data)
          if (ev.type === 'progress') {
            state.modelProgress[id] = ev.pct ?? 0
            rerenderRows()
          } else if (ev.type === 'done') {
            state.modelStatus[id] = 'installed'
            state.modelProgress[id] = 100
            delete state.activeDownload[id]
            rerenderRows()
            ws.close()
          } else if (ev.type === 'cancelled' || ev.type === 'error') {
            state.modelStatus[id] = 'available'
            state.modelProgress[id] = 0
            delete state.activeDownload[id]
            rerenderRows()
            ws.close()
          }
        }
        ws.onerror = () => {
          state.modelStatus[id] = 'available'
          delete state.activeDownload?.[id]
          rerenderRows()
        }
      })
      .catch(() => {
        state.modelStatus[id] = 'available'
        rerenderRows()
      })
  }
}

function _makeDeleteHandler(state, rerenderRows, onSuccess = null) {
  return function onDelete(id) {
    fetch(`${API_BASE}/models/${id}`, { method: 'DELETE' })
      .then(r => {
        if (r.ok) {
          state.modelStatus[id] = 'available'
          if (onSuccess) onSuccess(id)
          rerenderRows()
        }
      })
  }
}

// ── Model row shared helpers ───────────────────────────────────────────────────

function _makeDownloadBar(pct) {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'display:flex;align-items:center;gap:10.5px;margin-top:7px'
  const bar = document.createElement('div')
  bar.style.cssText = 'flex:1;height:5px;background:rgba(40,30,80,0.08);border-radius:3px;overflow:hidden;max-width:294px'
  const fill = document.createElement('div')
  fill.style.cssText = `height:100%;background:linear-gradient(135deg,#5A57F2,#8E5BEF);border-radius:3px;width:${pct}%;transition:width 0.6s ease`
  bar.appendChild(fill)
  const label = document.createElement('span')
  label.style.cssText = 'font-size:11.5px;color:rgba(25,24,42,0.55);font-family:ui-monospace,monospace;min-width:38px'
  label.textContent = Math.round(pct) + '%'
  wrap.appendChild(bar)
  wrap.appendChild(label)
  return wrap
}

function _makeStatusBadge(installed, downloading) {
  const el = document.createElement('div')
  el.className = 'st-model-status'
  if (installed) {
    el.innerHTML = `${icon('check', 12)} Installed`
    el.style.color = '#2EB387'
  } else if (downloading) {
    el.innerHTML = `<span class="st-spin"></span> Downloading`
    el.style.color = '#5A57F2'
  } else {
    el.innerHTML = `${icon('download', 12)} Not downloaded`
    el.style.color = 'rgba(25,24,42,0.55)'
  }
  return el
}

function _makeModelActions(modelId, state, { onDownload, onDelete, onSelect = null, rerenderRows = null }) {
  const actions = document.createElement('div')
  actions.className = 'st-model-actions'
  actions.addEventListener('click', e => e.stopPropagation())

  const status = state.modelStatus[modelId]
  const installed = status === 'installed'
  const downloading = status === 'downloading'

  if (!installed && !downloading) {
    const dlBtn = document.createElement('button')
    dlBtn.className = 'st-btn st-btn--primary st-btn--sm'
    dlBtn.textContent = 'Download'
    dlBtn.addEventListener('click', () => onDownload(modelId))
    actions.appendChild(dlBtn)
  }
  if (downloading) {
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'st-btn st-btn--ghost st-btn--sm'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.addEventListener('click', () => {
      const active = state.activeDownload?.[modelId]
      if (active) {
        fetch(`${API_BASE}/models/${modelId}/download/${active.job_id}`, { method: 'DELETE' })
          .finally(() => {
            active.ws.close()
            state.modelStatus[modelId] = 'available'
            state.modelProgress[modelId] = 0
            delete state.activeDownload[modelId]
            rerenderRows?.()
          })
      } else {
        state.modelStatus[modelId] = 'available'
        state.modelProgress[modelId] = 0
        rerenderRows?.()
      }
    })
    actions.appendChild(cancelBtn)
  }
  if (installed && onSelect && state.transcribeModel !== modelId) {
    const useBtn = document.createElement('button')
    useBtn.className = 'st-btn st-btn--ghost st-btn--sm'
    useBtn.textContent = 'Use'
    useBtn.addEventListener('click', () => onSelect(modelId))
    actions.appendChild(useBtn)
  }
  if (installed) {
    const delBtn = document.createElement('button')
    delBtn.className = 'st-btn st-btn--icon'
    delBtn.title = 'Remove'
    delBtn.innerHTML = icon('delete', 14)
    delBtn.addEventListener('click', () => onDelete(modelId))
    actions.appendChild(delBtn)
  }
  return actions
}

// ── Model row ──────────────────────────────────────────────────────────────────

function makeModelRow(model, state, onSelect, onDownload, onDelete) {
  const isDiarization = model.kind === 'diarization'
  const row = document.createElement('div')
  row.className = 'st-model-row'
  row.dataset.id = model.id

  function update() {
    const status = state.modelStatus[model.id]
    const installed = status === 'installed'
    const downloading = status === 'downloading'
    const isSelected = !isDiarization && state.transcribeModel === model.id

    row.classList.toggle('st-model-row--selected', isSelected)
    row.innerHTML = ''

    const icon = document.createElement('div')
    icon.className = 'st-model-icon' + (isSelected ? ' st-model-icon--selected' : '')
    icon.innerHTML = isDiarization
      ? icon('speakers', 17)
      : icon('waveform', 17)

    const info = document.createElement('div')
    info.className = 'st-model-info'
    const nameRow = document.createElement('div')
    nameRow.className = 'st-model-name-row'
    const name = document.createElement('span')
    name.className = 'st-model-name'
    name.textContent = model.name
    nameRow.appendChild(name)
    if (model.recommended) nameRow.appendChild(makePill('Recommended', 'accent'))
    if (isSelected) nameRow.appendChild(makePill('In use', 'ok'))
    if (isDiarization) nameRow.appendChild(makePill('Diarization', 'amber'))
    const meta = document.createElement('div')
    meta.className = 'st-model-meta'
    meta.textContent = `${model.size}  ·  ${model.speed}  ·  ${model.acc}`
    if (downloading) meta.appendChild(_makeDownloadBar(state.modelProgress[model.id] ?? 0))
    info.appendChild(nameRow)
    info.appendChild(meta)

    row.appendChild(icon)
    row.appendChild(info)
    row.appendChild(_makeStatusBadge(installed, downloading))
    row.appendChild(_makeModelActions(model.id, state, {
      onDownload, onDelete, onSelect: isDiarization ? null : onSelect, rerenderRows: update,
    }))

    row.style.cursor = (installed && !isDiarization) ? 'pointer' : 'default'
    row.onclick = (installed && !isDiarization) ? () => onSelect(model.id) : null
  }

  update()
  row._update = update
  return row
}

// ── Alignment model row ────────────────────────────────────────────────────────

function makeAlignmentModelRow(model, state, onDownload, onDelete) {
  const langEntry = LANGUAGES.find(l => l.code === model.lang)
  const flag = langEntry ? langEntry.flag : '🌐'

  const row = document.createElement('div')
  row.className = 'st-model-row'
  row.dataset.id = model.id
  row.style.cursor = 'default'

  function update() {
    const status = state.modelStatus[model.id]
    const installed = status === 'installed'
    const downloading = status === 'downloading'

    row.innerHTML = ''

    const icon = document.createElement('div')
    icon.className = 'st-model-icon'
    icon.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:19px'
    icon.textContent = flag

    const info = document.createElement('div')
    info.className = 'st-model-info'
    const nameRow = document.createElement('div')
    nameRow.className = 'st-model-name-row'
    const nameEl = document.createElement('span')
    nameEl.className = 'st-model-name'
    nameEl.textContent = model.name
    nameRow.appendChild(nameEl)
    if (model.nativeName && model.nativeName !== model.name) {
      const native = document.createElement('span')
      native.style.cssText = 'font-size:12px;color:rgba(25,24,42,0.5);margin-left:6px'
      native.textContent = model.nativeName
      nameRow.appendChild(native)
    }
    const meta = document.createElement('div')
    meta.className = 'st-model-meta'
    meta.textContent = model.size + '  ·  wav2vec2'
    if (downloading) meta.appendChild(_makeDownloadBar(state.modelProgress[model.id] ?? 0))
    info.appendChild(nameRow)
    info.appendChild(meta)

    row.appendChild(icon)
    row.appendChild(info)
    row.appendChild(_makeStatusBadge(installed, downloading))
    row.appendChild(_makeModelActions(model.id, state, { onDownload, onDelete, rerenderRows: update }))
  }

  update()
  row._update = update
  return row
}

// ── Settings sections ──────────────────────────────────────────────────────────

function buildInterfaceSection(state) {
  const langOpts = LANGUAGES.filter(l => l.code !== 'auto').map(l => ({ value: l.code, ...l }))

  const langDrop = makeLangDropdown(langOpts, state.uiLang, v => { state.uiLang = v })

  const slider = makeSlider(state.scale, 50, 200, 5, [
    { value: 50, label: '50%' }, { value: 100, label: '100%' },
    { value: 150, label: '150%' }, { value: 200, label: '200%' },
  ], v => {
    state.scale = v
  }, v => {
    window.electronAPI.setZoom(v / 100)
    saveSettings({ scale: v })
  })

  return makeSectionCard([
    makeSectionHeader(
      icon('interface', 18),
      'Interface', 'App language, appearance, and sizing.'
    ),
    makeFieldRow('App language', 'Language used across menus and dialogs.', langDrop),
    makeFieldRow('Interface scale', 'Affects type sizes and spacing.', slider, true),
  ])
}

// Stored by the backend with the queue (PUT /queue/settings), not in settings.json.
function makeStartModeDropdown() {
  const opts = [
    { value: 'auto', label: 'Automatically' },
    { value: 'manual', label: 'Manually' },
  ]
  return makeDropdown(opts, app._queue?.start_mode || 'auto', v => {
    app._queueRequest('/queue/settings', { method: 'PUT', body: { start_mode: v } })
  })
}

function buildModelsSection(state, rerender) {
  const langOpts = LANGUAGES.map(l => ({ value: l.code, ...l }))
  const langDrop = makeLangDropdown(langOpts, state.transcribeLang, v => { state.transcribeLang = v })

  const modelRows = document.createElement('div')
  modelRows.className = 'st-model-list'

  function rerenderRows() {
    modelRows.querySelectorAll('.st-model-row').forEach(r => r._update && r._update())
  }

  function onSelect(id) {
    state.transcribeModel = id
    saveSettings({ transcribeModel: id })
    rerenderRows()
  }

  const onDownload = _makeDownloadHandler(state, rerenderRows)
  const onDelete   = _makeDeleteHandler(state, rerenderRows, id => {
    if (state.transcribeModel === id) {
      state.transcribeModel = 'small'
      saveSettings({ transcribeModel: 'small' })
    }
  })

  // Fetch full catalog + install status from API; render rows when ready.
  fetch(`${API_BASE}/models`)
    .then(r => r.json())
    .then(models => {
      const whisperAndDiarize = models.filter(m => m.kind !== 'alignment')
      whisperAndDiarize.forEach(m => {
        state.modelStatus[m.id] = m.installed ? 'installed' : 'available'
        modelRows.appendChild(makeModelRow(m, state, onSelect, onDownload, onDelete))
      })
    })
    .catch(() => { /* server not running — rows remain empty */ })

  const footer = document.createElement('div')
  footer.className = 'st-models-footer'
  footer.innerHTML = `${icon('alert', 14)}
    Models stored in <code class="st-code">.models/</code>`

  const modelControl = document.createElement('div')
  modelControl.appendChild(modelRows)
  modelControl.appendChild(footer)

  return makeSectionCard([
    makeSectionHeader(
      icon('models', 18),
      'ML Models', 'Whisper transcription · diarization · language.'
    ),
    makeFieldRow('Transcription language', 'Whisper auto-detects when set to "Detect".', langDrop),
    makeFieldRow('Start transcription',
      'Automatically: new recordings and imports are transcribed right away. Manually: they wait until you press Start in the queue.',
      makeStartModeDropdown()),
    modelControl,
  ])
}

function buildAlignmentSection(state) {
  const alignRows = document.createElement('div')
  alignRows.className = 'st-model-list'

  function rerenderRows() {
    alignRows.querySelectorAll('.st-model-row').forEach(r => r._update && r._update())
  }

  const onDownload = _makeDownloadHandler(state, rerenderRows)
  const onDelete   = _makeDeleteHandler(state, rerenderRows)

  ALIGNMENT_MODELS.forEach(m => {
    alignRows.appendChild(makeAlignmentModelRow(m, state, onDownload, onDelete))
  })

  // Load real install status from API
  fetch(`${API_BASE}/models`)
    .then(r => r.json())
    .then(models => {
      models.forEach(({ id, installed }) => {
        if (id in state.modelStatus) {
          state.modelStatus[id] = installed ? 'installed' : 'available'
        }
      })
      rerenderRows()
    })
    .catch(() => { /* server not running — keep defaults */ })

  const footer = document.createElement('div')
  footer.className = 'st-models-footer'
  footer.innerHTML = `${icon('alert', 14)}
    Stored in <code class="st-code">.models/alignment/</code>. Not needed for English, French, German, Spanish, or Italian.`

  const wrapper = document.createElement('div')
  wrapper.appendChild(alignRows)
  wrapper.appendChild(footer)

  return makeSectionCard([
    makeSectionHeader(
      icon('alignment', 18),
      'Alignment Models', 'wav2vec2 word-level timestamps — download for each language you use.'
    ),
    wrapper,
  ])
}

function buildApiKeysSection(state) {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%'

  const input = document.createElement('input')
  input.type = 'password'
  input.className = 'st-text-input'
  input.placeholder = 'hf_...'
  input.value = state.hfToken || ''
  input.autocomplete = 'off'
  input.spellcheck = false

  let visible = false
  const eyeBtn = document.createElement('button')
  eyeBtn.className = 'st-btn st-btn--icon'
  eyeBtn.title = 'Show / hide token'
  eyeBtn.innerHTML = icon('eye', 14)
  eyeBtn.addEventListener('click', () => {
    visible = !visible
    input.type = visible ? 'text' : 'password'
  })

  input.addEventListener('change', () => {
    state.hfToken = input.value.trim()
    saveSettings({ hfToken: state.hfToken })
  })

  wrap.appendChild(input)
  wrap.appendChild(eyeBtn)

  return makeSectionCard([
    makeSectionHeader(
      icon('api-keys', 18),
      'API Keys', 'Credentials for accessing ML model providers.'
    ),
    makeFieldRow(
      'HuggingFace token',
      'Required for speaker diarization (PyAnnote). Create a read token at huggingface.co/settings/tokens.',
      wrap,
      true
    ),
  ])
}

function buildExportSection(state) {
  // Format tiles
  const tilesWrap = document.createElement('div')
  tilesWrap.className = 'st-format-tiles'

  ST_EXPORT_FORMATS.forEach(f => {
    const tile = document.createElement('button')
    tile.className = 'st-format-tile' + (state.exportFormat === f.id ? ' st-format-tile--active' : '')
    tile.innerHTML = `<div class="st-format-tile-top">
      <span class="st-format-tile-name">${f.label}</span>
      <span class="st-format-tile-ext">${f.ext}</span>
    </div>
    <div class="st-format-tile-desc">${f.desc}</div>`
    tile.addEventListener('click', () => {
      state.exportFormat = f.id
      tilesWrap.querySelectorAll('.st-format-tile').forEach(t => t.classList.remove('st-format-tile--active'))
      tile.classList.add('st-format-tile--active')
    })
    tilesWrap.appendChild(tile)
  })

  // Include toggles
  const togglesWrap = document.createElement('div')
  togglesWrap.className = 'st-include-toggles'

  const toggleDefs = [
    { key: 'incTimestamps', label: 'Timestamps' },
    { key: 'incSpeakers',   label: 'Speaker labels' },
    { key: 'incBookmarks',  label: 'Bookmarks' },
    { key: 'incAudio',      label: 'Original audio file' },
  ]
  toggleDefs.forEach(({ key, label }) => {
    const row = document.createElement('label')
    row.className = 'st-toggle-row'
    const t = makeToggle(state[key], v => { state[key] = v })
    const lbl = document.createElement('span')
    lbl.textContent = label
    row.appendChild(t)
    row.appendChild(lbl)
    togglesWrap.appendChild(row)
  })

  // Duplicate toggle
  const dupRow = document.createElement('div')
  dupRow.style.cssText = 'display:flex;align-items:center;gap:10.5px'
  const dupToggle = makeToggle(state.duplicate, v => { state.duplicate = v })
  const dupLbl = document.createElement('span')
  dupLbl.style.cssText = 'font-size:12.5px;color:rgba(25,24,42,0.55)'
  dupLbl.textContent = 'Always create a copy'
  dupRow.appendChild(dupToggle)
  dupRow.appendChild(dupLbl)

  return makeSectionCard([
    makeSectionHeader(
      icon('export', 18),
      'Export', 'Default format and destination for exports.'
    ),
    makeFieldRow('Default format', 'Used when exporting without selecting a format.', tilesWrap),
    makeFieldRow('Duplicate on export', 'Keeps the original and writes a copy.', dupRow),
    makeFieldRow('Include in export', 'Toggles affect every export format.', togglesWrap, true),
  ])
}

function buildAudioSection(state) {
  const controlsWrap = document.createElement('div')

  const spinner = document.createElement('div')
  spinner.style.cssText = 'padding:14px 0 6px;font-size:13px;color:rgba(25,24,42,0.4)'
  spinner.textContent = 'Detecting audio devices…'
  controlsWrap.appendChild(spinner)

  ;(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(t => t.stop())
    } catch (_) {}

    let inputs = []
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      inputs = all.filter(d => d.kind === 'audioinput')
    } catch (_) {}

    function renderDevOpt(opt) {
      const s = document.createElement('span')
      s.style.cssText = 'display:inline-flex;flex-direction:column;flex:1;min-width:0;overflow:hidden'
      const label = document.createElement('span')
      label.style.cssText = 'font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
      label.textContent = opt.label
      s.appendChild(label)
      return s
    }

    const micOpts = [
      { value: null, label: 'System default' },
      ...inputs.map(d => ({ value: d.deviceId, label: d.label || `Microphone (${d.deviceId.slice(0, 8)})` })),
    ]
    const micVal = micOpts.some(o => o.value === state.recordingMicDevice) ? state.recordingMicDevice : null
    const micDrop = makeDropdown(micOpts, micVal, v => {
      state.recordingMicDevice = v
      saveSettings({ recordingMicDevice: v })
    }, renderDevOpt)
    micDrop.style.width = '260px'

    const micToggle = makeToggle(state.recordingUseMic, v => {
      state.recordingUseMic = v
      saveSettings({ recordingUseMic: v })
    })

    // System audio: on macOS/Linux fetch sources from backend (bypasses Chromium restrictions).
    // On Windows use browser devices (WASAPI loopback is handled by Electron's setDisplayMediaRequestHandler).
    const platform = await window.electronAPI.getPlatform()
    const sysOpts = [
      { value: null, label: 'Disabled' },
      ...await listSystemAudioSources(platform, inputs),
    ]

    const sysVal = sysOpts.some(o => o.value === state.recordingSystemDevice) ? state.recordingSystemDevice : null
    const sysDrop = makeDropdown(sysOpts, sysVal, v => {
      state.recordingSystemDevice = v
      saveSettings({ recordingSystemDevice: v })
    }, renderDevOpt)
    sysDrop.style.width = '260px'

    controlsWrap.innerHTML = ''
    controlsWrap.appendChild(makeFieldRow('Microphone', 'Captured during live recording.', micDrop))
    controlsWrap.appendChild(makeFieldRow('Include microphone', 'Record mic alongside system audio.', micToggle))
    controlsWrap.appendChild(makeFieldRow('System audio source', 'Select the system audio source to capture.', sysDrop, true))
  })()

  return makeSectionCard([
    makeSectionHeader(
      icon('microphone', 18),
      'Audio devices', 'Input devices for live recording.'
    ),
    controlsWrap,
  ])
}

// Two-step destructive action: [trigger] → [Cancel] [confirm]. onConfirm
// returns a promise; the buttons are disabled while it runs.
function makeConfirmButtons(triggerLabel, confirmLabel, onConfirm) {
  const btns = document.createElement('div')
  btns.className = 'st-reset-btns'

  const triggerBtn = document.createElement('button')
  triggerBtn.className = 'st-btn st-btn--ghost'
  triggerBtn.textContent = triggerLabel

  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'st-btn st-btn--ghost'
  cancelBtn.textContent = 'Cancel'

  const confirmBtn = document.createElement('button')
  confirmBtn.className = 'st-btn st-btn--danger'
  confirmBtn.textContent = confirmLabel

  const showConfirm = on => {
    triggerBtn.style.display = on ? 'none' : ''
    cancelBtn.style.display = on ? '' : 'none'
    confirmBtn.style.display = on ? '' : 'none'
  }
  showConfirm(false)

  triggerBtn.addEventListener('click', () => showConfirm(true))
  cancelBtn.addEventListener('click', () => showConfirm(false))
  confirmBtn.addEventListener('click', async () => {
    cancelBtn.disabled = confirmBtn.disabled = true
    try {
      await onConfirm()
    } finally {
      cancelBtn.disabled = confirmBtn.disabled = false
      showConfirm(false)
    }
  })

  btns.append(triggerBtn, cancelBtn, confirmBtn)
  btns._trigger = triggerBtn
  return btns
}

function makeWarningText(label, hint) {
  const text = document.createElement('div')
  text.className = 'st-reset-text'
  text.innerHTML = `<div class="st-reset-icon">!</div>
    <div>
      <div class="st-field-label"></div>
      <div class="st-field-hint" style="margin-top:3px"></div>
    </div>`
  text.querySelector('.st-field-label').textContent = label
  text.querySelector('.st-field-hint').textContent = hint
  return text
}

function buildResetSection() {
  const wrap = document.createElement('div')
  wrap.className = 'st-reset-wrap'

  wrap.appendChild(makeWarningText(
    'This resets all preferences shown on this page.',
    'Transcripts, downloaded models, recordings and your Hugging Face token are kept. '
      + 'The app will use automatic language detection, the small model, 100% scale and default audio devices.'
  ))
  wrap.appendChild(makeConfirmButtons('Reset…', 'Confirm reset', async () => {
    await saveSettings(defaultSettingsPatch(DEFAULT_APP_SETTINGS, appSettings))
    window.electronAPI.setZoom(appSettings.scale / 100)
    app.showSettings()
    showToast('Preferences reset to defaults.')
  }))

  return makeSectionCard([
    makeSectionHeader(
      icon('alert', 18),
      'Reset to defaults', 'Restore Whisper preferences to their initial state.'
    ),
    wrap,
  ])
}

function buildDeleteDataSection() {
  const wrap = document.createElement('div')
  wrap.className = 'st-reset-wrap'

  wrap.appendChild(makeWarningText(
    'This permanently deletes all transcripts, all speakers and their voice profiles '
      + 'and live recordings.',
    'This cannot be undone. Audio files you imported stay where they are; '
      + 'downloaded models and preferences are kept.'
  ))

  const btns = makeConfirmButtons('Delete…', 'Delete everything', async () => {
    try {
      const r = await fetch(`${API_BASE}/data/reset`, { method: 'POST' })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`)
      app._activeTranscriptId = null
      app._loadSidebar()
      showToast(formatDataResetSummary(body))
    } catch (err) {
      showToast(`Could not delete data: ${err.message}`, 'error')
    }
  })
  wrap.appendChild(btns)

  const blocked = dataResetBlockReason(app._queue?.running_job_id ? 1 : 0, app._liveSession)
  if (blocked) {
    btns._trigger.disabled = true
    btns._trigger.title = blocked
  }

  return makeSectionCard([
    makeSectionHeader(
      icon('delete', 20),
      'Delete all data', 'Start over with an empty library.'
    ),
    wrap,
  ])
}

// ── Main settings view ─────────────────────────────────────────────────────────

function renderSettingsView() {
  const state = makeSettings()

  const root = document.createElement('div')
  root.className = 'settings-layout'

  // ── Content ─────────────────────────────────────────────────────────────────
  const content = document.createElement('div')
  content.className = 'settings-content quiet-scroll'

  const sections = [
    { id: 'interface', build: () => buildInterfaceSection(state) },
    { id: 'models',    build: () => buildModelsSection(state) },
    { id: 'alignment', build: () => buildAlignmentSection(state) },
    { id: 'apikeys',   build: () => buildApiKeysSection(state) },
    { id: 'export',    build: () => buildExportSection(state) },
    { id: 'audio',     build: () => buildAudioSection(state) },
    { id: 'reset',     build: () => buildResetSection() },
    { id: 'data',      build: () => buildDeleteDataSection() },
  ]

  sections.forEach(s => {
    const anchor = document.createElement('div')
    anchor.dataset.section = s.id
    anchor.appendChild(s.build())
    content.appendChild(anchor)
  })

  root.appendChild(content)
  root._cleanup = () => Object.values(state.activeDownload || {}).forEach(d => d.ws?.close())
  return root
}
