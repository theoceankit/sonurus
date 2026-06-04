// ── Static data ────────────────────────────────────────────────────────────────
// LANGUAGES and MODELS are loaded from data.js

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

function makeSectionHeader(svgPath, label, sub) {
  const wrap = document.createElement('div')
  wrap.className = 'st-section-header'

  const icon = document.createElement('div')
  icon.className = 'st-section-icon'
  icon.innerHTML = svgPath

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
    const isSelected = isDiarization ? false : state.transcribeModel === model.id

    row.classList.toggle('st-model-row--selected', isSelected)
    row.innerHTML = ''

    // Icon
    const icon = document.createElement('div')
    icon.className = 'st-model-icon' + (isSelected ? ' st-model-icon--selected' : '')
    icon.innerHTML = isDiarization
      ? `<svg width="17" height="17" viewBox="0 0 18 18" fill="none"><circle cx="6" cy="6" r="2" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="6" r="2" stroke="currentColor" stroke-width="1.4"/><path d="M3 14c0-2 1.6-3 3-3s3 1 3 3M9 14c0-2 1.6-3 3-3s3 1 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>`
      : `<svg width="17" height="17" viewBox="0 0 18 18" fill="none"><path d="M9 2v14M3 5l-1.5 3L3 11M15 5l1.5 3L15 11M6 4l-1 5 1 5M12 4l1 5-1 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`

    // Info
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

    if (downloading) {
      const pct = state.modelProgress[model.id] ?? 0
      const pgWrap = document.createElement('div')
      pgWrap.style.cssText = 'display:flex;align-items:center;gap:10.5px;margin-top:7px'
      const bar = document.createElement('div')
      bar.style.cssText = 'flex:1;height:5px;background:rgba(40,30,80,0.08);border-radius:3px;overflow:hidden;max-width:294px'
      const barFill = document.createElement('div')
      barFill.style.cssText = `height:100%;background:linear-gradient(135deg,#5A57F2,#8E5BEF);border-radius:3px;width:${pct}%;transition:width 0.6s ease`
      bar.appendChild(barFill)
      const pctLabel = document.createElement('span')
      pctLabel.style.cssText = 'font-size:11.5px;color:rgba(25,24,42,0.55);font-family:ui-monospace,monospace;min-width:38px'
      pctLabel.textContent = Math.round(pct) + '%'
      pgWrap.appendChild(bar)
      pgWrap.appendChild(pctLabel)
      meta.appendChild(pgWrap)
    }

    info.appendChild(nameRow)
    info.appendChild(meta)

    // Status
    const statusEl = document.createElement('div')
    statusEl.className = 'st-model-status'
    if (installed) {
      statusEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.5l2.5 2.5L10 3" stroke="#2EB387" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Installed`
      statusEl.style.color = '#2EB387'
    } else if (downloading) {
      statusEl.innerHTML = `<span class="st-spin"></span> Downloading`
      statusEl.style.color = '#5A57F2'
    } else {
      statusEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5v7M3 6l3 3 3-3M2 11h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg> Not downloaded`
      statusEl.style.color = 'rgba(25,24,42,0.55)'
    }

    // Actions
    const actions = document.createElement('div')
    actions.className = 'st-model-actions'
    actions.addEventListener('click', e => e.stopPropagation())

    if (!installed && !downloading) {
      const dlBtn = document.createElement('button')
      dlBtn.className = 'st-btn st-btn--primary st-btn--sm'
      dlBtn.textContent = 'Download'
      dlBtn.addEventListener('click', () => onDownload(model.id))
      actions.appendChild(dlBtn)
    }
    if (downloading) {
      const cancelBtn = document.createElement('button')
      cancelBtn.className = 'st-btn st-btn--ghost st-btn--sm'
      cancelBtn.textContent = 'Cancel'
      cancelBtn.addEventListener('click', () => {
        const active = state.activeDownload?.[model.id]
        if (active) {
          fetch(`${API_BASE}/models/${model.id}/download/${active.job_id}`, { method: 'DELETE' })
            .finally(() => {
              active.ws.close()
              state.modelStatus[model.id] = 'available'
              state.modelProgress[model.id] = 0
              delete state.activeDownload[model.id]
              update()
            })
        } else {
          state.modelStatus[model.id] = 'available'
          state.modelProgress[model.id] = 0
          update()
        }
      })
      actions.appendChild(cancelBtn)
    }
    if (installed && !isSelected && !isDiarization) {
      const useBtn = document.createElement('button')
      useBtn.className = 'st-btn st-btn--ghost st-btn--sm'
      useBtn.textContent = 'Use'
      useBtn.addEventListener('click', () => onSelect(model.id))
      actions.appendChild(useBtn)
    }
    if (installed) {
      const delBtn = document.createElement('button')
      delBtn.className = 'st-btn st-btn--icon'
      delBtn.title = 'Remove'
      delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2.5 4h9M5 4V2.5h4V4M3.5 4l.5 7.5h6L10.5 4M6 6.5v3M8 6.5v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      delBtn.addEventListener('click', () => onDelete(model.id))
      actions.appendChild(delBtn)
    }

    row.appendChild(icon)
    row.appendChild(info)
    row.appendChild(statusEl)
    row.appendChild(actions)

    if (installed && !isDiarization) {
      row.style.cursor = 'pointer'
      row.onclick = () => onSelect(model.id)
    } else {
      row.style.cursor = 'default'
      row.onclick = null
    }
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

    // Flag icon
    const icon = document.createElement('div')
    icon.className = 'st-model-icon'
    icon.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:19px'
    icon.textContent = flag

    // Info
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

    if (downloading) {
      const pct = state.modelProgress[model.id] ?? 0
      const pgWrap = document.createElement('div')
      pgWrap.style.cssText = 'display:flex;align-items:center;gap:10.5px;margin-top:7px'
      const bar = document.createElement('div')
      bar.style.cssText = 'flex:1;height:5px;background:rgba(40,30,80,0.08);border-radius:3px;overflow:hidden;max-width:294px'
      const barFill = document.createElement('div')
      barFill.style.cssText = `height:100%;background:linear-gradient(135deg,#5A57F2,#8E5BEF);border-radius:3px;width:${pct}%;transition:width 0.6s ease`
      bar.appendChild(barFill)
      const pctLabel = document.createElement('span')
      pctLabel.style.cssText = 'font-size:11.5px;color:rgba(25,24,42,0.55);font-family:ui-monospace,monospace;min-width:38px'
      pctLabel.textContent = Math.round(pct) + '%'
      pgWrap.appendChild(bar)
      pgWrap.appendChild(pctLabel)
      meta.appendChild(pgWrap)
    }

    info.appendChild(nameRow)
    info.appendChild(meta)

    // Status
    const statusEl = document.createElement('div')
    statusEl.className = 'st-model-status'
    if (installed) {
      statusEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.5l2.5 2.5L10 3" stroke="#2EB387" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Installed`
      statusEl.style.color = '#2EB387'
    } else if (downloading) {
      statusEl.innerHTML = `<span class="st-spin"></span> Downloading`
      statusEl.style.color = '#5A57F2'
    } else {
      statusEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5v7M3 6l3 3 3-3M2 11h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg> Not downloaded`
      statusEl.style.color = 'rgba(25,24,42,0.55)'
    }

    // Actions
    const actions = document.createElement('div')
    actions.className = 'st-model-actions'
    actions.addEventListener('click', e => e.stopPropagation())

    if (!installed && !downloading) {
      const dlBtn = document.createElement('button')
      dlBtn.className = 'st-btn st-btn--primary st-btn--sm'
      dlBtn.textContent = 'Download'
      dlBtn.addEventListener('click', () => onDownload(model.id))
      actions.appendChild(dlBtn)
    }
    if (downloading) {
      const cancelBtn = document.createElement('button')
      cancelBtn.className = 'st-btn st-btn--ghost st-btn--sm'
      cancelBtn.textContent = 'Cancel'
      cancelBtn.addEventListener('click', () => {
        const active = state.activeDownload?.[model.id]
        if (active) {
          fetch(`${API_BASE}/models/${model.id}/download/${active.job_id}`, { method: 'DELETE' })
            .finally(() => {
              active.ws.close()
              state.modelStatus[model.id] = 'available'
              state.modelProgress[model.id] = 0
              delete state.activeDownload[model.id]
              update()
            })
        } else {
          state.modelStatus[model.id] = 'available'
          state.modelProgress[model.id] = 0
          update()
        }
      })
      actions.appendChild(cancelBtn)
    }
    if (installed) {
      const delBtn = document.createElement('button')
      delBtn.className = 'st-btn st-btn--icon'
      delBtn.title = 'Remove'
      delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2.5 4h9M5 4V2.5h4V4M3.5 4l.5 7.5h6L10.5 4M6 6.5v3M8 6.5v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      delBtn.addEventListener('click', () => onDelete(model.id))
      actions.appendChild(delBtn)
    }

    row.appendChild(icon)
    row.appendChild(info)
    row.appendChild(statusEl)
    row.appendChild(actions)
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
      `<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2.5" y="3" width="13" height="10" rx="1.6" stroke="currentColor" stroke-width="1.4"/>
        <path d="M6 15.5h6M9 13.5v2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>`,
      'Interface', 'App language, appearance, and sizing.'
    ),
    makeFieldRow('App language', 'Language used across menus and dialogs.', langDrop),
    makeFieldRow('Interface scale', 'Affects type sizes and spacing.', slider, true),
  ])
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
  footer.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M7 4v3.5M7 9.5v.01" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
    Models stored in <code class="st-code">.models/</code>`

  const modelControl = document.createElement('div')
  modelControl.appendChild(modelRows)
  modelControl.appendChild(footer)

  return makeSectionCard([
    makeSectionHeader(
      `<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="5" cy="5" r="1.8" stroke="currentColor" stroke-width="1.4"/>
        <circle cx="13" cy="13" r="1.8" stroke="currentColor" stroke-width="1.4"/>
        <circle cx="13" cy="5" r="1.8" stroke="currentColor" stroke-width="1.4"/>
        <circle cx="5" cy="13" r="1.8" stroke="currentColor" stroke-width="1.4"/>
        <path d="M6.5 5h5M6.5 13h5M5 6.5v5M13 6.5v5" stroke="currentColor" stroke-width="1.4"/>
      </svg>`,
      'ML Models', 'Whisper transcription · diarization · language.'
    ),
    makeFieldRow('Transcription language', 'Whisper auto-detects when set to "Detect".', langDrop),
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
  footer.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M7 4v3.5M7 9.5v.01" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
    Stored in <code class="st-code">.models/alignment/</code>. Not needed for English, French, German, Spanish, or Italian.`

  const wrapper = document.createElement('div')
  wrapper.appendChild(alignRows)
  wrapper.appendChild(footer)

  return makeSectionCard([
    makeSectionHeader(
      `<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M2 5h14M2 9h9M2 13h11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        <circle cx="15.5" cy="13" r="2" stroke="currentColor" stroke-width="1.3"/>
        <path d="M17 14.5l1.5 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>`,
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
  eyeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M1 7s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4z" stroke="currentColor" stroke-width="1.3"/>
    <circle cx="7" cy="7" r="1.8" stroke="currentColor" stroke-width="1.3"/>
  </svg>`
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
      `<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="8" cy="7.5" r="3.5" stroke="currentColor" stroke-width="1.4"/>
        <path d="M10.5 10.5L15 15" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        <path d="M8 5.5v2M7 6.5h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>`,
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
      `<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2v9M5.5 7.5L9 11l3.5-3.5M3 13v2h12v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
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
    const sysOpts = [{ value: null, label: 'Disabled' }]

    if (platform === 'win32') {
      inputs
        .filter(d => /virtual|loopback|system|output|mix|monitor/i.test(d.label))
        .forEach(d => sysOpts.push({ value: d.deviceId, label: d.label || `Device (${d.deviceId.slice(0, 8)})` }))
      if (sysOpts.length === 1) {
        sysOpts.push({ value: '__desktop__', label: 'System audio (WASAPI)' })
      }
    } else {
      try {
        const r = await fetch(`${API_BASE}/audio/capture/sources`)
        if (r.ok) {
          const { sources } = await r.json()
          sources.forEach(s => sysOpts.push({ value: s.id, label: s.label }))
        }
      } catch (_) {}
    }

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
      `<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2a3 3 0 013 3v4a3 3 0 01-6 0V5a3 3 0 013-3z" stroke="currentColor" stroke-width="1.4" fill="none"/>
        <path d="M4 9a5 5 0 0010 0M9 14v2M6 16h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>`,
      'Audio devices', 'Input devices for live recording.'
    ),
    controlsWrap,
  ])
}

function buildResetSection() {
  const wrap = document.createElement('div')
  wrap.className = 'st-reset-wrap'

  const text = document.createElement('div')
  text.className = 'st-reset-text'
  text.innerHTML = `<div class="st-reset-icon">!</div>
    <div>
      <div class="st-field-label">This resets all preferences shown on this page.</div>
      <div class="st-field-hint" style="margin-top:3px">Transcripts, downloaded models, and recordings will not be deleted. The app will use English, system defaults, and the small model.</div>
    </div>`

  const btns = document.createElement('div')
  btns.className = 'st-reset-btns'

  const resetBtn = document.createElement('button')
  resetBtn.className = 'st-btn st-btn--ghost'
  resetBtn.textContent = 'Reset…'

  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'st-btn st-btn--ghost'
  cancelBtn.textContent = 'Cancel'
  cancelBtn.style.display = 'none'

  const confirmBtn = document.createElement('button')
  confirmBtn.className = 'st-btn st-btn--danger'
  confirmBtn.textContent = 'Confirm reset'
  confirmBtn.style.display = 'none'

  resetBtn.addEventListener('click', () => {
    resetBtn.style.display = 'none'
    cancelBtn.style.display = ''
    confirmBtn.style.display = ''
  })
  cancelBtn.addEventListener('click', () => {
    resetBtn.style.display = ''
    cancelBtn.style.display = 'none'
    confirmBtn.style.display = 'none'
  })
  confirmBtn.addEventListener('click', () => {
    cancelBtn.style.display = 'none'
    confirmBtn.style.display = 'none'
    resetBtn.style.display = ''
  })

  btns.appendChild(resetBtn)
  btns.appendChild(cancelBtn)
  btns.appendChild(confirmBtn)
  wrap.appendChild(text)
  wrap.appendChild(btns)

  return makeSectionCard([
    makeSectionHeader(
      `<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 3a6 6 0 100 12A6 6 0 009 3z" stroke="currentColor" stroke-width="1.4" fill="none"/>
        <path d="M9 7v4M9 12.5v.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>`,
      'Reset to defaults', 'Restore Whisper preferences to their initial state.'
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
  ]

  sections.forEach(s => {
    const anchor = document.createElement('div')
    anchor.dataset.section = s.id
    anchor.appendChild(s.build())
    content.appendChild(anchor)
  })

  root.appendChild(content)
  return root
}
