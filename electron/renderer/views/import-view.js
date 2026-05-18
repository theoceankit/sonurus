// ── Import view v2 ─────────────────────────────────────────────────────────────
// Mode-selection tiles + pre-flight configuration panel.
// Only "Upload file" is wired to the backend (Live/Dictate are coming soon).

function renderImportView() {

  // ── Static data (language list and model catalogue from data.js) ────────────

  const langOptions = LANGUAGES.map(l => ({ ...l, value: l.code }))

  const modelOptions = MODELS
    .filter(m => m.kind === 'whisper')
    .map(m => ({ value: m.id, label: m.name, sub: `${m.size} · ${m.speed}` }))

  const TILE_DEFS = [
    {
      id: 'live',
      title: 'Live recording',
      desc: 'Captures microphone + system audio at the same time. Ideal for Zoom, Meet, or Discord calls.',
      hue: 'linear-gradient(135deg,#EF4F6E 0%,#F08055 100%)',
      hueSoft: 'rgba(239,79,110,0.10)',
      hueText: '#C73655',
      cta: 'Start recording',
      foot: 'system + mic ready',
      icon: `<svg width="23" height="23" viewBox="0 0 26 26" fill="none">
        <rect x="9" y="3" width="8" height="14" rx="4" stroke="currentColor" stroke-width="1.8" fill="rgba(255,255,255,0.18)"/>
        <path d="M5 13v.5A8 8 0 0013 21.5v0a8 8 0 008-8V13M13 21.5V25M8 25h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>
      </svg>`,
      comingSoon: true,
    },
    {
      id: 'dictate',
      title: 'Dictation note',
      desc: 'Microphone-only quick capture for ideas, voice memos, or solo planning sessions.',
      hue: 'linear-gradient(135deg,#5A57F2 0%,#8E5BEF 100%)',
      hueSoft: 'rgba(90,87,242,0.10)',
      hueText: '#5A57F2',
      cta: 'Start dictating',
      foot: 'Microphone only · note',
      icon: `<svg width="23" height="23" viewBox="0 0 26 26" fill="none">
        <path d="M13 3v17M7 9l-2 4 2 4M19 9l2 4-2 4M10 6l-1 7 1 7M16 6l1 7-1 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>`,
      comingSoon: true,
    },
    {
      id: 'upload',
      title: 'Upload file',
      desc: 'Drop an audio or video file. Whisper transcribes and diarizes it in the background.',
      hue: 'linear-gradient(135deg,#2EB387 0%,#4CC9C2 100%)',
      hueSoft: 'rgba(46,179,135,0.10)',
      hueText: '#1F8A66',
      cta: 'Choose file…',
      foot: '.mp3 · .wav · .m4a · .mp4',
      icon: `<svg width="23" height="23" viewBox="0 0 26 26" fill="none">
        <path d="M13 17V4M7.5 9.5L13 4l5.5 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M4 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>
      </svg>`,
      comingSoon: false,
    },
  ]

  // ── State ────────────────────────────────────────────────────────────────────

  let selectedPath = null
  let selectedName = null
  let langValue = appSettings.transcribeLang || 'auto'
  let modelValue = appSettings.transcribeModel || 'large-v3'

  // ── Root ─────────────────────────────────────────────────────────────────────

  const root = document.createElement('div')
  root.className = 'import-view'

  // ── Page header ──────────────────────────────────────────────────────────────

  const pageHeader = document.createElement('div')
  pageHeader.className = 'import-page-header'
  pageHeader.innerHTML = `
    <div class="import-page-hdr-text">
      <div class="import-page-title">Start a new recording</div>
      <div class="import-page-sub">Capture a meeting live, dictate a quick note, or transcribe an existing audio or video file.</div>
    </div>
    <div class="import-status-badge">
      <span class="sb-footer-dot"></span>
      Whisper service running
    </div>
  `
  root.appendChild(pageHeader)

  // ── Scroll area ──────────────────────────────────────────────────────────────

  const scroll = document.createElement('div')
  scroll.className = 'import-scroll quiet-scroll'
  root.appendChild(scroll)

  // ── Mode tiles ───────────────────────────────────────────────────────────────

  const heroEl = document.createElement('div')
  heroEl.className = 'mode-hero'
  scroll.appendChild(heroEl)

  TILE_DEFS.forEach(t => {
    const tile = document.createElement('button')
    tile.className = [
      'action-tile',
      t.comingSoon  ? 'action-tile--coming-soon' : '',
      !t.comingSoon ? 'action-tile--active'       : '',
    ].filter(Boolean).join(' ')
    tile.disabled = t.comingSoon

    // Decorative halo
    const halo = document.createElement('div')
    halo.className = 'action-tile-halo'
    halo.style.background = t.hue
    tile.appendChild(halo)

    // Top row: icon + badge
    const topRow = document.createElement('div')
    topRow.className = 'action-tile-top'

    const iconBox = document.createElement('div')
    iconBox.className = 'action-tile-icon'
    iconBox.style.background = t.hue
    iconBox.innerHTML = t.icon

    const topSpacer = document.createElement('div')
    topSpacer.style.flex = '1'

    const badge = document.createElement('span')
    if (t.comingSoon) {
      badge.className = 'action-tile-badge action-tile-badge--soon'
      badge.textContent = 'Coming soon'
    } else {
      badge.className = 'action-tile-badge action-tile-badge--selected'
      badge.innerHTML = `<span class="action-tile-badge-dot"></span>Selected`
    }

    topRow.appendChild(iconBox)
    topRow.appendChild(topSpacer)
    topRow.appendChild(badge)
    tile.appendChild(topRow)

    // Title + description
    const bodyEl = document.createElement('div')
    const titleEl = document.createElement('div')
    titleEl.className = 'action-tile-title'
    titleEl.textContent = t.title
    const descEl = document.createElement('div')
    descEl.className = 'action-tile-desc'
    descEl.textContent = t.desc
    bodyEl.appendChild(titleEl)
    bodyEl.appendChild(descEl)
    tile.appendChild(bodyEl)

    // Push footer to bottom
    const midSpacer = document.createElement('div')
    midSpacer.style.flex = '1'
    tile.appendChild(midSpacer)

    // Footer: small label + CTA chip
    const tileFooter = document.createElement('div')
    tileFooter.className = 'action-tile-footer'

    const footText = document.createElement('span')
    footText.className = 'action-tile-foot-text'
    footText.textContent = t.foot

    const cta = document.createElement('span')
    cta.className = 'action-tile-cta'
    cta.style.background = !t.comingSoon ? t.hue : t.hueSoft
    cta.style.color      = !t.comingSoon ? '#fff' : t.hueText
    cta.innerHTML = `${t.cta} <svg width="10" height="8" viewBox="0 0 11 9" fill="none"><path d="M1 4.5h9M6.5 1l3.5 3.5L6.5 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`

    tileFooter.appendChild(footText)
    tileFooter.appendChild(cta)
    tile.appendChild(tileFooter)

    heroEl.appendChild(tile)
  })

  // ── Pre-flight card ──────────────────────────────────────────────────────────

  const card = document.createElement('div')
  card.className = 'preflight-card'
  scroll.appendChild(card)

  // Card header
  const cardHeader = document.createElement('div')
  cardHeader.className = 'preflight-header'
  cardHeader.innerHTML = `
    <span class="preflight-pill preflight-pill--ok">
      <span class="preflight-pill-dot" style="background:#1F8A66"></span>UPLOAD
    </span>
    <span class="preflight-mode-label">Pick a file to transcribe</span>
    <div style="flex:1"></div>
    <span class="preflight-dest">Default destination · ~/Documents/Whisper</span>
  `
  card.appendChild(cardHeader)

  // Title section label
  const titleLabelRow = document.createElement('div')
  titleLabelRow.className = 'preflight-section-label'
  titleLabelRow.innerHTML = `<span>Title</span><span class="preflight-section-line"></span>`
  card.appendChild(titleLabelRow)

  // Title input
  const titleInput = document.createElement('input')
  titleInput.type = 'text'
  titleInput.className = 'preflight-title-input'
  titleInput.placeholder = 'Untitled recording'
  card.appendChild(titleInput)

  // Drop zone container (content is rebuilt on file selection/removal)
  const dropZoneWrap = document.createElement('div')
  dropZoneWrap.style.marginBottom = '14.5px'
  card.appendChild(dropZoneWrap)

  // Language dropdown
  const langDropdown = makeDropdown(
    langOptions,
    langValue,
    v => { langValue = v; saveSettings({ transcribeLang: v }) },
    (opt, isTrigger) => {
      const s = document.createElement('span')
      s.style.cssText = 'display:inline-flex;align-items:center;gap:8px'
      s.innerHTML = `<span>${opt.flag}</span><span>${opt.label}</span>`
      return s
    }
  )
  langDropdown.style.width = '231px'

  // Model dropdown
  const modelDropdown = makeDropdown(
    modelOptions,
    modelValue,
    v => { modelValue = v; saveSettings({ transcribeModel: v }) },
    (opt, isTrigger) => {
      if (isTrigger) {
        const s = document.createElement('span')
        s.textContent = opt.label
        return s
      }
      const w = document.createElement('span')
      w.style.cssText = 'display:flex;flex-direction:column;gap:1px;flex:1;min-width:0'
      const n = document.createElement('span')
      n.style.fontWeight = '500'
      n.textContent = opt.label
      const sub = document.createElement('span')
      sub.style.cssText = 'font-size:11.5px;color:rgba(25,24,42,0.40);font-family:monospace'
      sub.textContent = opt.sub
      w.appendChild(n)
      w.appendChild(sub)
      return w
    }
  )
  modelDropdown.style.width = '252px'

  card.appendChild(buildOptionRow(
    `<svg width="15" height="15" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.4"/>
      <path d="M2.5 9h13M9 2.5c2 2 2 11 0 13M9 2.5c-2 2-2 11 0 13" stroke="currentColor" stroke-width="1.4"/>
    </svg>`,
    'Language',
    'Whisper auto-detects when set to "Detect automatically".',
    langDropdown
  ))

  card.appendChild(buildOptionRow(
    `<svg width="15" height="15" viewBox="0 0 18 18" fill="none">
      <circle cx="5" cy="5" r="1.7" stroke="currentColor" stroke-width="1.4"/>
      <circle cx="13" cy="5" r="1.7" stroke="currentColor" stroke-width="1.4"/>
      <circle cx="9" cy="13" r="1.7" stroke="currentColor" stroke-width="1.4"/>
      <path d="M5 6.5v3.5h8V6.5" stroke="currentColor" stroke-width="1.4"/>
    </svg>`,
    'Model',
    'Larger models are more accurate but slower.',
    modelDropdown,
    true
  ))

  // Error banner
  const errorBannerEl = document.createElement('div')
  errorBannerEl.className = 'error-banner'
  errorBannerEl.style.cssText = 'display:none;margin-top:10.5px'
  card.appendChild(errorBannerEl)

  // Card footer
  const cardFooter = document.createElement('div')
  cardFooter.className = 'preflight-footer'

  const footerInfo = document.createElement('div')
  footerInfo.className = 'preflight-footer-info'
  footerInfo.innerHTML = `
    <span class="sb-footer-dot"></span>
    <span>On-device · private</span>
    <span style="margin:0 4px;opacity:0.4">·</span>
    <span>Auto-saves to workspace</span>
  `

  const startBtn = document.createElement('button')
  startBtn.className = 'st-btn st-btn--primary'
  startBtn.style.cssText = 'height:36px;padding:0 19px;font-size:14px;gap:8px'

  cardFooter.appendChild(footerInfo)
  cardFooter.appendChild(startBtn)
  card.appendChild(cardFooter)

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function buildOptionRow(iconSvg, label, hint, control, last = false) {
    const row = document.createElement('div')
    row.className = 'preflight-option-row' + (last ? ' preflight-option-row--last' : '')

    const iconBox = document.createElement('div')
    iconBox.className = 'preflight-option-icon'
    iconBox.innerHTML = iconSvg

    const info = document.createElement('div')
    info.className = 'preflight-option-info'
    info.innerHTML = `
      <div class="preflight-option-label">${label}</div>
      <div class="preflight-option-hint">${hint}</div>
    `

    row.appendChild(iconBox)
    row.appendChild(info)
    row.appendChild(control)
    return row
  }

  function updateDropZone() {
    dropZoneWrap.innerHTML = ''

    const dz = document.createElement('div')
    dz.className = 'drop-zone'

    // Drag & drop events
    dz.addEventListener('dragover', e => {
      e.preventDefault()
      dz.classList.add('drop-zone--over')
    })
    dz.addEventListener('dragleave', () => dz.classList.remove('drop-zone--over'))
    dz.addEventListener('drop', e => {
      e.preventDefault()
      dz.classList.remove('drop-zone--over')
      const f = e.dataTransfer.files?.[0]
      if (f) {
        selectedPath = window.electronAPI.getFilePath(f)
        selectedName = f.name
        errorBannerEl.style.display = 'none'
        updateDropZone()
        updateStartBtn()
      }
    })

    // Icon
    const iconBox = document.createElement('div')
    iconBox.className = 'drop-zone-icon'
    iconBox.innerHTML = `<svg width="24" height="24" viewBox="0 0 26 26" fill="none">
      <rect x="3" y="11" width="20" height="11" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/>
      <path d="M9 11V7a4 4 0 018 0v4M13 14v5M11 16l2-2 2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`
    dz.appendChild(iconBox)

    // Content
    const content = document.createElement('div')
    content.className = 'drop-zone-content'

    if (selectedPath) {
      const nameRow = document.createElement('div')
      nameRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:2px;min-width:0'

      const nameEl = document.createElement('span')
      nameEl.className = 'drop-zone-title'
      nameEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0'
      nameEl.textContent = selectedName

      const readyPill = document.createElement('span')
      readyPill.style.cssText = [
        'display:inline-flex;align-items:center;gap:5px',
        'padding:2px 8px;border-radius:5px;flex-shrink:0',
        'font-size:10.5px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase',
        'background:rgba(46,179,135,0.10);color:#1F8A66;border:0.5px solid rgba(46,179,135,0.30)',
      ].join(';')
      readyPill.innerHTML = '<span style="width:5px;height:5px;border-radius:50%;background:#1F8A66;display:inline-block"></span>&nbsp;Ready'

      nameRow.appendChild(nameEl)
      nameRow.appendChild(readyPill)
      content.appendChild(nameRow)
    } else {
      const titleEl = document.createElement('div')
      titleEl.className = 'drop-zone-title'
      titleEl.textContent = 'Drag and drop a file here'

      const subEl = document.createElement('div')
      subEl.className = 'drop-zone-sub'
      subEl.innerHTML = 'Audio: .mp3 .wav .m4a .ogg &nbsp;·&nbsp; Video: .mp4 .mov .mkv &nbsp;·&nbsp; Max&nbsp;4&nbsp;GB'

      content.appendChild(titleEl)
      content.appendChild(subEl)
    }
    dz.appendChild(content)

    // Action buttons
    const actions = document.createElement('div')
    actions.className = 'drop-zone-actions'

    if (selectedPath) {
      const removeBtn = document.createElement('button')
      removeBtn.className = 'st-btn st-btn--ghost st-btn--sm'
      removeBtn.textContent = 'Remove'
      removeBtn.addEventListener('click', () => {
        selectedPath = null
        selectedName = null
        errorBannerEl.style.display = 'none'
        updateDropZone()
        updateStartBtn()
      })
      actions.appendChild(removeBtn)
    }

    const browseBtn = document.createElement('button')
    browseBtn.className = 'st-btn st-btn--ghost st-btn--sm'
    browseBtn.style.gap = '6px'
    browseBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <path d="M2 11h8M6 1v8M3 6l3 3 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>Browse…`
    browseBtn.addEventListener('click', () => {
      window.electronAPI.openFile().then(path => {
        if (!path) return
        selectedPath = path
        selectedName = path.split(/[\\/]/).pop()
        errorBannerEl.style.display = 'none'
        updateDropZone()
        updateStartBtn()
      })
    })
    actions.appendChild(browseBtn)

    dz.appendChild(actions)
    dropZoneWrap.appendChild(dz)
  }

  function updateStartBtn() {
    const can = !!selectedPath
    startBtn.disabled = !can
    startBtn.style.opacity = can ? '1' : '0.55'
    startBtn.style.cursor  = can ? 'pointer' : 'not-allowed'
    startBtn.innerHTML = can
      ? `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
           <path d="M1 6l3.5 3.5L11 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
         </svg>Transcribe file<span style="display:inline-flex;gap:3px;margin-left:8px;opacity:0.80">
           <span style="font-family:monospace;font-size:10.5px;padding:1px 5px;border-radius:4px;background:rgba(255,255,255,0.22)">⌘</span>
           <span style="font-family:monospace;font-size:10.5px;padding:1px 5px;border-radius:4px;background:rgba(255,255,255,0.22)">↵</span>
         </span>`
      : `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
           <path d="M1 6l3.5 3.5L11 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
         </svg>Choose a file to begin`
  }

  // ── Start transcription ───────────────────────────────────────────────────────

  startBtn.addEventListener('click', () => {
    if (!selectedPath) return
    errorBannerEl.style.display = 'none'
    startBtn.disabled = true

    fetch(`${API_BASE}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_path: selectedPath,
        whisper_model: modelValue,
        language: langValue === 'auto' ? null : langValue,
      }),
    })
      .then(r => {
        if (!r.ok) throw new Error(`Server error ${r.status}`)
        return r.json()
      })
      .then(({ job_id }) => app.showProgress(job_id))
      .catch(err => {
        errorBannerEl.textContent = `Could not start transcription: ${err.message}`
        errorBannerEl.style.display = 'block'
        startBtn.disabled = false
        updateStartBtn()
      })
  })

  // ── Init ─────────────────────────────────────────────────────────────────────

  updateDropZone()
  updateStartBtn()

  return root
}
