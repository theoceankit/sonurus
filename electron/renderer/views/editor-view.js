// ── Singleton tooltip (appended to body, position: fixed — escapes all clipping) ──
let _segTooltipEl = null
function _getTooltip() {
  if (!_segTooltipEl) {
    _segTooltipEl = document.createElement('div')
    _segTooltipEl.className = 'seg-tooltip'
    document.body.appendChild(_segTooltipEl)
  }
  return _segTooltipEl
}

function attachSegTooltip(btn) {
  btn.addEventListener('mouseenter', () => {
    const text = btn.getAttribute('data-tooltip')
    if (!text) return
    const tt = _getTooltip()
    tt.textContent = text
    tt.classList.remove('seg-tooltip--visible')
    tt.style.left = '-10499px'
    tt.style.top = '-10499px'

    // Measure after text is set
    requestAnimationFrame(() => {
      const bRect = btn.getBoundingClientRect()
      const tRect = tt.getBoundingClientRect()
      const idealLeft = bRect.left + bRect.width / 2 - tRect.width / 2
      const left = Math.max(8, Math.min(idealLeft, window.innerWidth - tRect.width - 8))
      const top = bRect.top - tRect.height - 8

      // Arrow points at center of button regardless of clamping
      const arrowLeft = bRect.left + bRect.width / 2 - left
      tt.style.setProperty('--arrow-left', arrowLeft + 'px')
      tt.style.left = left + 'px'
      tt.style.top = top + 'px'
      tt.classList.add('seg-tooltip--visible')
    })
  })
  btn.addEventListener('mouseleave', () => {
    const tt = _getTooltip()
    tt.classList.remove('seg-tooltip--visible')
  })
}

// ── Speaker picker popup ──────────────────────────────────────────────────────
function showSpeakerPicker(anchorEl, currentSpkId, knownSpeakers, transcriptId, onReload, segmentStart = null) {
  document.getElementById('_spk-picker')?.remove()

  const popup = document.createElement('div')
  popup.id = '_spk-picker'
  popup.className = 'spk-picker'

  const search = document.createElement('input')
  search.className = 'spk-picker-search'
  search.placeholder = 'Search speakers…'
  popup.appendChild(search)

  const list = document.createElement('div')
  list.className = 'spk-picker-list'
  popup.appendChild(list)

  const others = knownSpeakers.filter(s => s.id !== currentSpkId)

  function buildList(filter) {
    list.innerHTML = ''
    const items = filter
      ? others.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()))
      : others
    items.forEach(s => {
      const row = document.createElement('div')
      row.className = 'spk-picker-item'
      row.appendChild(makeAvatar(s.id, s.name, 22))
      const nm = document.createElement('span')
      nm.className = 'spk-picker-item-name'
      nm.textContent = s.name
      row.appendChild(nm)
      row.addEventListener('mousedown', e => {
        e.preventDefault()
        const isSingle = segmentStart !== null
        const url = isSingle
          ? `${API_BASE}/transcripts/${transcriptId}/segments/${segmentStart}/speaker`
          : `${API_BASE}/transcripts/${transcriptId}/reassign`
        const body = isSingle
          ? JSON.stringify({ speaker_id: s.id })
          : JSON.stringify({ from_speaker_id: currentSpkId, to_speaker_id: s.id })
        fetch(url, { method: isSingle ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body })
          .then(r => { if (!r.ok) throw new Error(r.status); popup.remove(); onReload() })
      })
      list.appendChild(row)
    })
  }
  buildList('')
  search.addEventListener('input', () => buildList(search.value))

  const sep = document.createElement('div')
  sep.className = 'spk-picker-sep'
  popup.appendChild(sep)

  const newWrap = document.createElement('div')
  newWrap.className = 'spk-picker-new'

  const newTrigger = document.createElement('button')
  newTrigger.className = 'spk-picker-new-btn'
  newTrigger.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg> New speaker`

  const newInput = document.createElement('input')
  newInput.className = 'spk-picker-new-input'
  newInput.placeholder = 'Full name…'

  newTrigger.addEventListener('click', () => {
    newTrigger.style.display = 'none'
    newInput.style.display = 'block'
    newInput.focus()
  })
  newInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const name = newInput.value.trim()
      if (!name) return
      fetch(`${API_BASE}/transcripts/${transcriptId}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_speaker_id: currentSpkId, to_speaker_name: name }),
      }).then(r => { if (!r.ok) throw new Error(r.status); popup.remove(); onReload() })
    }
    if (e.key === 'Escape') popup.remove()
  })

  newWrap.appendChild(newTrigger)
  newWrap.appendChild(newInput)
  popup.appendChild(newWrap)

  document.body.appendChild(popup)

  // Position: right-aligned to anchor, below it
  requestAnimationFrame(() => {
    const rect = anchorEl.getBoundingClientRect()
    const pw = popup.offsetWidth || 220
    const left = Math.max(8, Math.min(rect.right - pw, window.innerWidth - pw - 8))
    popup.style.left = left + 'px'
    popup.style.top = (rect.bottom + 6) + 'px'
  })

  search.focus()

  setTimeout(() => {
    function handler(e) {
      if (!popup.contains(e.target) && e.target !== anchorEl) {
        popup.remove()
        document.removeEventListener('mousedown', handler)
      }
    }
    document.addEventListener('mousedown', handler)
  }, 0)
}

// ── Segment row ────────────────────────────────────────────────────────────────
function makeSegmentRow(seg, transcriptId, displayName, onReload, knownMap = {}, knownSpeakers = [], audio = null) {
  const spkId = effectiveSpeaker(seg)
  const p = isUnrecognized(spkId, knownMap) ? null : speakerPalette(spkId)
  let editing = false

  const row = document.createElement('div')
  row.className = 'seg-row'
  row.dataset.start = seg.start
  row.dataset.end = seg.end

  // ── Time column ──────────────────────────────────────────────────────────────
  const time = document.createElement('button')
  time.className = 'seg-time'
  time.title = `${fmtTime(seg.start)} – ${fmtTime(seg.end)}`

  const timeLabel = document.createElement('span')
  timeLabel.textContent = fmtTime(seg.start)

  const timeProg = document.createElement('div')
  timeProg.className = 'seg-time-prog'

  time.appendChild(timeLabel)
  time.appendChild(timeProg)

  time.addEventListener('click', () => { if (audio) audio.currentTime = seg.start })

  // ── Middle column ────────────────────────────────────────────────────────────
  const mid = document.createElement('div')
  mid.className = 'seg-mid'

  const header = document.createElement('div')
  header.className = 'seg-header'

  const dot = document.createElement('span')
  dot.className = 'seg-spk-dot'
  dot.style.background = p ? p.color : 'var(--ink-4)'

  const nameBtn = document.createElement('button')
  nameBtn.className = 'seg-speaker-name'
  nameBtn.textContent = displayName
  if (p) nameBtn.style.color = p.color
  nameBtn.addEventListener('click', e => {
    e.stopPropagation()
    showSpeakerPicker(nameBtn, spkId, knownSpeakers, transcriptId, onReload, seg.start)
  })

  const chevron = document.createElement('span')
  chevron.className = 'seg-spk-chevron'
  chevron.innerHTML = `<svg width="8" height="5" viewBox="0 0 9 6" fill="none">
    <path d="M1 1.5l3.5 3 3.5-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`

  header.appendChild(dot)
  header.appendChild(nameBtn)
  header.appendChild(chevron)

  // Text
  const textEl = document.createElement('div')
  textEl.className = 'seg-text'
  textEl.textContent = seg.text

  // Edit mode
  const editWrap = document.createElement('div')
  editWrap.className = 'seg-edit-wrap'
  editWrap.style.display = 'none'

  const editArea = document.createElement('div')
  editArea.className = 'seg-edit-area'
  editArea.contentEditable = 'true'
  editArea.textContent = seg.text

  const editHint = document.createElement('div')
  editHint.className = 'seg-edit-hint'
  editHint.textContent = '⌘↵ to save · esc to cancel'

  editWrap.appendChild(editArea)
  editWrap.appendChild(editHint)

  mid.appendChild(header)
  mid.appendChild(textEl)
  mid.appendChild(editWrap)

  // ── Actions column (3rd grid column) ─────────────────────────────────────────
  const actions = document.createElement('div')
  actions.className = 'seg-actions'

  function makeActionBtn(tooltip, svgHtml) {
    const btn = document.createElement('button')
    btn.className = 'seg-action-btn'
    btn.setAttribute('data-tooltip', tooltip)
    btn.innerHTML = svgHtml
    attachSegTooltip(btn)
    return btn
  }

  const bookmarkBtn = makeActionBtn('Bookmark segment', `<svg width="10" height="12" viewBox="0 0 11 13" fill="none">
    <path d="M1.5 1.5h8v10l-4-2.5-4 2.5v-10z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  </svg>`)

  const moreBtn = makeActionBtn('More actions', `<svg width="12" height="3" viewBox="0 0 13 3" fill="none">
    <circle cx="1.5" cy="1.5" r="1.1" fill="currentColor"/>
    <circle cx="6.5" cy="1.5" r="1.1" fill="currentColor"/>
    <circle cx="11.5" cy="1.5" r="1.1" fill="currentColor"/>
  </svg>`)

  // More actions: inline copy + delete
  moreBtn.addEventListener('click', e => {
    e.stopPropagation()
    const existing = document.getElementById('_seg-more-menu')
    if (existing) { existing.remove(); return }

    const menu = document.createElement('div')
    menu.id = '_seg-more-menu'
    menu.style.cssText = [
      'position:fixed;z-index:9999;background:#fff;border:0.5px solid var(--border)',
      'border-radius:8px;padding:4px;box-shadow:0 8px 20px rgba(0,0,0,0.12)',
      'min-width:160px',
    ].join(';')

    const items = [
      { label: 'Copy text', action: () => navigator.clipboard.writeText(seg.text).then(() => window.showToast?.('Copied to clipboard')).catch(() => window.showToast?.('Copy failed')) },
      { label: 'Edit text', action: enterEditMode },
      { label: 'Delete segment', danger: true, action: () => {
        fetch(`${API_BASE}/transcripts/${transcriptId}/segments/${seg.start}`, { method: 'DELETE' })
          .then(r => { if (!r.ok) throw new Error(r.status) })
          .then(() => { row.style.opacity = '0'; row.style.transition = 'opacity 0.15s'; setTimeout(() => { row.remove(); onReload() }, 150) })
      }},
    ]

    items.forEach(it => {
      const btn = document.createElement('button')
      btn.style.cssText = `display:flex;align-items:center;width:100%;padding:6px 9px;border:none;background:transparent;cursor:pointer;border-radius:5px;font-size:13px;font-family:inherit;text-align:left;color:${it.danger ? '#FF453A' : 'var(--ink)'}`
      btn.textContent = it.label
      btn.onmouseenter = () => { btn.style.background = 'rgba(0,0,0,0.04)' }
      btn.onmouseleave = () => { btn.style.background = 'transparent' }
      btn.addEventListener('click', () => { menu.remove(); it.action() })
      menu.appendChild(btn)
    })

    document.body.appendChild(menu)
    const r = moreBtn.getBoundingClientRect()
    menu.style.left = Math.max(8, r.right - menu.offsetWidth) + 'px'
    menu.style.top = (r.bottom + 4) + 'px'

    setTimeout(() => {
      function close(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close) } }
      document.addEventListener('mousedown', close)
    }, 0)
  })

  actions.appendChild(bookmarkBtn)
  actions.appendChild(moreBtn)

  row.appendChild(time)
  row.appendChild(mid)
  row.appendChild(actions)

  // ── Interactions ─────────────────────────────────────────────────────────────

  function enterEditMode() {
    if (editing) return
    editing = true
    row.classList.add('seg-row--editing')
    textEl.style.display = 'none'
    editWrap.style.display = 'block'
    editArea.textContent = seg.text
    editArea.focus()
    const range = document.createRange()
    range.selectNodeContents(editArea)
    range.collapse(false)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  }

  function commitEdit() {
    const newText = editArea.innerText.trim()
    if (!newText || newText === seg.text) { cancelEdit(); return }
    fetch(`${API_BASE}/transcripts/${transcriptId}/segments/${seg.start}/text`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newText }),
    }).then(() => { seg.text = newText; textEl.textContent = newText; cancelEdit() })
      .catch(() => cancelEdit())
  }

  function cancelEdit() {
    editing = false
    row.classList.remove('seg-row--editing')
    editWrap.style.display = 'none'
    textEl.style.display = ''
  }

  textEl.addEventListener('click', enterEditMode)

  editArea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit() }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
  })

  return row
}

// ── Speaker card (right panel) ─────────────────────────────────────────────────
function makeSpeakerCard(spkId, displayName, segCount, totalSec, transcriptDurSec, transcriptId, onReload, knownSpeakers = []) {
  const _knownMap = {}
  knownSpeakers.forEach(s => { _knownMap[s.id] = s.name })
  const unrecognized = isUnrecognized(spkId, _knownMap)
  const p = unrecognized ? null : speakerPalette(spkId)

  const card = document.createElement('div')
  card.className = unrecognized ? 'spk-card spk-card--unknown' : 'spk-card'

  // Header row
  const top = document.createElement('div')
  top.className = 'spk-card-top'

  const avatar = makeAvatar(spkId, displayName, 28)
  const info = document.createElement('div')
  info.className = 'spk-card-info'

  const nameEl = document.createElement('div')
  nameEl.className = 'spk-card-name'
  nameEl.textContent = displayName

  const metaEl = document.createElement('div')
  metaEl.className = 'spk-card-meta'
  metaEl.textContent = `${segCount} segments · ${fmtTime(totalSec)}`

  info.appendChild(nameEl)
  info.appendChild(metaEl)

  // ── Hover action buttons ────────────────────────────────────────────────
  const cardActions = document.createElement('div')
  cardActions.className = 'spk-card-actions'

  const playCardBtn = document.createElement('button')
  playCardBtn.className = 'spk-card-btn'
  playCardBtn.setAttribute('data-tooltip', 'Play speaker')
  playCardBtn.innerHTML = `<svg width="9" height="11" viewBox="0 0 9 11" fill="none">
    <path d="M1.5 1.2L7.5 5.5 1.5 9.8V1.2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  </svg>`
  attachSegTooltip(playCardBtn)

  const reassignCardBtn = document.createElement('button')
  reassignCardBtn.className = 'spk-card-btn'
  reassignCardBtn.setAttribute('data-tooltip', 'Assign speaker')
  reassignCardBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 11V8a2 2 0 0 0-2-2h-6m0 0l3 3m-3-3l3-3M3 13.013v3a2 2 0 0 0 2 2h6m0 0l-3-3m3 3l-3 3m8-4.511a2 2 0 1 0 4.001-.001a2 2 0 0 0-4.001.001m-12-12a2 2 0 1 0 4.001-.001A2 2 0 0 0 4 4.502m17 16.997a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2m-6-12a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2"/>
  </svg>`
  attachSegTooltip(reassignCardBtn)
  reassignCardBtn.addEventListener('click', e => {
    e.stopPropagation()
    showSpeakerPicker(reassignCardBtn, spkId, knownSpeakers, transcriptId, onReload)
  })

  cardActions.appendChild(playCardBtn)
  if (!unrecognized) cardActions.appendChild(reassignCardBtn)

  top.appendChild(avatar)
  top.appendChild(info)
  top.appendChild(cardActions)
  card.appendChild(top)

  // Duration bar (all speakers)
  if (transcriptDurSec > 0) {
    const pct = Math.round(totalSec / transcriptDurSec * 100)
    const barWrap = document.createElement('div')
    barWrap.className = 'spk-dur-wrap'

    const track = document.createElement('div')
    track.className = 'spk-dur-track'
    const fill = document.createElement('div')
    fill.className = 'spk-dur-fill'
    fill.style.width = pct + '%'
    fill.style.background = p ? p.color : '#B58A3A'
    track.appendChild(fill)

    const pctLbl = document.createElement('span')
    pctLbl.className = 'spk-dur-pct'
    pctLbl.textContent = pct + '%'

    barWrap.appendChild(track)
    barWrap.appendChild(pctLbl)
    card.appendChild(barWrap)
  }

  // Name button (unrecognized only) → opens picker popup
  if (unrecognized) {
    const btnRow = document.createElement('div')
    btnRow.className = 'spk-btn-row'

    const nameBtn = document.createElement('button')
    nameBtn.className = 'spk-btn spk-btn--outline'
    nameBtn.textContent = 'Name…'
    nameBtn.addEventListener('click', e => {
      e.stopPropagation()
      showSpeakerPicker(nameBtn, spkId, knownSpeakers, transcriptId, onReload)
    })

    btnRow.appendChild(nameBtn)
    card.appendChild(btnRow)
  }

  return card
}

// ── Waveform ───────────────────────────────────────────────────────────────────
function buildWaveform(segs, audio, signal, knownMap = {}) {
  const BARS = 120

  const heights = (() => {
    const arr = []; let seed = 11
    for (let i = 0; i < BARS; i++) {
      seed = (seed * 9301 + 49297) % 233280
      const r = seed / 233280
      const env = 0.45 + 0.55 * Math.abs(Math.sin(i * 0.13)) * (0.7 + 0.3 * Math.cos(i * 0.05))
      arr.push(Math.max(0.10, Math.min(1, env * (0.55 + 0.55 * r))))
    }
    return arr
  })()

  const DEFAULT_BAR_COLOR = 'rgba(0,0,0,0.22)'

  const wrap = document.createElement('div')
  wrap.className = 'waveform'

  const barEls = heights.map((h, i) => {
    const bar = document.createElement('div')
    bar.className = 'waveform-bar'
    bar.style.height = Math.round(h * 78) + '%'
    bar.style.background = DEFAULT_BAR_COLOR
    wrap.appendChild(bar)
    return bar
  })

  // Hover scrubber
  const scrubLine = document.createElement('div')
  scrubLine.className = 'waveform-scrub'
  wrap.appendChild(scrubLine)

  const scrubTip = document.createElement('div')
  scrubTip.className = 'waveform-tip'
  wrap.appendChild(scrubTip)

  function colorAt(i) {
    if (!audio.duration) return null
    const t = (i + 0.5) / BARS * audio.duration
    const seg = segs.find(s => t >= s.start && t < s.end)
    if (!seg) return null
    const spkId = effectiveSpeaker(seg)
    return isUnrecognized(spkId, knownMap) ? null : speakerPalette(spkId).color
  }

  function updateColors() {
    barEls.forEach((bar, i) => {
      const c = colorAt(i)
      bar.style.background = c || DEFAULT_BAR_COLOR
    })
  }

  function updateFill() {
    if (!audio.duration) return
    const filled = (audio.currentTime / audio.duration) * BARS
    barEls.forEach((bar, i) => { bar.style.opacity = i <= filled ? '1' : '0.32' })
  }

  audio.addEventListener('loadedmetadata', () => { updateColors(); updateFill() }, { signal })
  audio.addEventListener('timeupdate', updateFill, { signal })

  // Seek interaction
  let dragging = false
  function seekAt(e) {
    const rect = wrap.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    if (audio.duration) audio.currentTime = pct * audio.duration
  }
  function moveScrubber(e) {
    const rect = wrap.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const t = audio.duration ? (x / rect.width) * audio.duration : 0
    scrubLine.style.left = x + 'px'
    scrubLine.style.display = 'block'
    scrubTip.textContent = fmtTime(t)
    scrubTip.style.left = x + 'px'
    scrubTip.style.display = 'block'
  }
  wrap.addEventListener('mousedown', e => { dragging = true; seekAt(e) })
  wrap.addEventListener('mousemove', e => { moveScrubber(e); if (dragging) seekAt(e) })
  document.addEventListener('mouseup', () => { dragging = false }, { signal })
  wrap.addEventListener('mouseleave', () => {
    if (!dragging) {
      scrubLine.style.display = 'none'
      scrubTip.style.display = 'none'
    }
  })

  return wrap
}

// ── Player bar ─────────────────────────────────────────────────────────────────
function makePlayerBar(transcript, audio, signal, knownSpeakers = []) {
  const segs = transcript.segments

  const bar = document.createElement('div')
  bar.className = 'player-bar'

  // ── Icons ──────────────────────────────────────────────────────────────────
  const I_PREV_SPK = `<svg width="15" height="13" viewBox="0 0 15 13" fill="none">
    <rect x="2" y="3" width="1.4" height="7" rx="0.4" fill="currentColor"/>
    <path d="M11.5 3L5 6.5L11.5 10V3z" fill="currentColor"/>
  </svg>`
  const I_PREV_15  = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M8 3.5L4.5 7l3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M5 7h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`
  const I_PLAY    = `<svg width="10" height="11" viewBox="0 0 10 12" fill="none" style="margin-left:1px">
    <path d="M1 1l8 5-8 5V1z" fill="currentColor"/>
  </svg>`
  const I_PAUSE   = `<svg width="10" height="11" viewBox="0 0 11 12" fill="none">
    <rect x="1" y="1" width="3" height="10" rx="0.7" fill="currentColor"/>
    <rect x="7" y="1" width="3" height="10" rx="0.7" fill="currentColor"/>
  </svg>`
  const I_NEXT_15  = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M6 3.5L9.5 7 6 10.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M3 7h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`
  const I_NEXT_SPK = `<svg width="15" height="13" viewBox="0 0 15 13" fill="none">
    <path d="M3.5 3L10 6.5L3.5 10V3z" fill="currentColor"/>
    <rect x="11.6" y="3" width="1.4" height="7" rx="0.4" fill="currentColor"/>
  </svg>`
  const I_VOLUME  = `<svg width="14" height="13" viewBox="0 0 16 14" fill="none">
    <path d="M2 5v4h2.5L8 11.5v-9L4.5 5H2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/>
    <path d="M10.5 4.5c1 .8 1 4.2 0 5M12.5 3c2 1.5 2 7 0 8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/>
  </svg>`

  function makeBtn(html, cls = '') {
    const btn = document.createElement('button')
    btn.className = 'player-btn' + (cls ? ' ' + cls : '')
    btn.innerHTML = html
    return btn
  }

  const prevSpkBtn = makeBtn(I_PREV_SPK)
  const prev15Btn  = makeBtn(I_PREV_15)
  const playBtn    = makeBtn(I_PLAY, 'player-btn--play')
  const next15Btn  = makeBtn(I_NEXT_15)
  const nextSpkBtn = makeBtn(I_NEXT_SPK)

  const controls = document.createElement('div')
  controls.className = 'player-controls'
  ;[prevSpkBtn, prev15Btn, playBtn, next15Btn, nextSpkBtn].forEach(b => controls.appendChild(b))

  // ── Elapsed ────────────────────────────────────────────────────────────────
  const elapsed = document.createElement('span')
  elapsed.className = 'player-time'
  elapsed.textContent = '00:00'

  // ── Waveform ───────────────────────────────────────────────────────────────
  const _km = {}; knownSpeakers.forEach(s => { _km[s.id] = s.name })
  const waveform = buildWaveform(segs, audio, signal, _km)

  // ── Total ─────────────────────────────────────────────────────────────────
  const total = document.createElement('span')
  total.className = 'player-time'
  total.style.textAlign = 'right'
  total.textContent = '00:00'

  // ── Speed ─────────────────────────────────────────────────────────────────
  const SPEEDS = [1, 1.25, 1.5, 2]
  let speedIdx = 0
  const speedBtn = document.createElement('button')
  speedBtn.className = 'player-speed'
  speedBtn.textContent = '1×'
  speedBtn.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length
    audio.playbackRate = SPEEDS[speedIdx]
    speedBtn.textContent = SPEEDS[speedIdx] + '×'
  })

  // ── Volume ────────────────────────────────────────────────────────────────
  const volBtn = makeBtn(I_VOLUME)
  audio.volume = 0.8
  let muted = false
  volBtn.addEventListener('click', () => {
    muted = !muted
    audio.muted = muted
    volBtn.style.opacity = muted ? '0.4' : '1'
  })

  bar.appendChild(controls)
  bar.appendChild(elapsed)
  bar.appendChild(waveform)
  bar.appendChild(total)
  bar.appendChild(speedBtn)
  bar.appendChild(volBtn)

  // ── Audio event wiring ─────────────────────────────────────────────────────
  audio.addEventListener('timeupdate', () => {
    elapsed.textContent = fmtTime(audio.currentTime)
  }, { signal })

  audio.addEventListener('durationchange', () => {
    if (isFinite(audio.duration)) total.textContent = fmtTime(audio.duration)
  }, { signal })

  audio.addEventListener('play',  () => { playBtn.innerHTML = I_PAUSE }, { signal })
  audio.addEventListener('pause', () => { playBtn.innerHTML = I_PLAY  }, { signal })
  audio.addEventListener('ended', () => { playBtn.innerHTML = I_PLAY  }, { signal })

  playBtn.addEventListener('click', () => {
    audio.paused ? audio.play().catch(() => {}) : audio.pause()
  })

  prev15Btn.addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 15) })
  next15Btn.addEventListener('click', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 15) })

  // ── Speaker navigation ─────────────────────────────────────────────────────
  function spkChanges() {
    const ch = [0]
    for (let i = 1; i < segs.length; i++) {
      if (effectiveSpeaker(segs[i]) !== effectiveSpeaker(segs[i - 1])) ch.push(i)
    }
    return ch
  }
  function curBlock(ch) {
    const t = audio.currentTime
    let b = 0
    for (let j = 0; j < ch.length; j++) { if (segs[ch[j]].start <= t) b = j }
    return b
  }

  prevSpkBtn.addEventListener('click', () => {
    const ch = spkChanges(), b = curBlock(ch)
    if (b > 0) audio.currentTime = segs[ch[b - 1]].start
  })
  nextSpkBtn.addEventListener('click', () => {
    const ch = spkChanges(), b = curBlock(ch)
    if (b + 1 < ch.length) audio.currentTime = segs[ch[b + 1]].start
  })

  return bar
}

// ── Right panel ────────────────────────────────────────────────────────────────
function makeRightPanel(transcript, knownSpeakers, transcriptId, onReload) {
  const panel = document.createElement('div')
  panel.className = 'right-panel'

  const knownMap = {}
  knownSpeakers.forEach(s => { knownMap[s.id] = s.name })

  // Stable "Unknown N" display name for unrecognized speakers
  const firstSeen = {}
  transcript.segments.forEach(s => {
    const id = effectiveSpeaker(s)
    if (isUnrecognized(id, knownMap) && !(id in firstSeen)) firstSeen[id] = s.start
  })
  const unrecIds = Object.keys(firstSeen).sort((a, b) => firstSeen[a] - firstSeen[b])
  function getDisplayName(spkId) {
    if (knownMap[spkId]) return knownMap[spkId]
    const n = unrecIds.indexOf(spkId) + 1
    return n > 0 ? `Unknown ${n}` : spkId
  }

  // ── Tab bar (segmented control) ─────────────────────────────────────────────
  const tabBar = document.createElement('div')
  tabBar.className = 'right-tabs'

  const seg = document.createElement('div')
  seg.className = 'right-tabs-seg'
  tabBar.appendChild(seg)

  const TABS = ['Speakers', 'Chapters', 'Notes', 'Activity']
  let activeTab = 'Speakers'

  const content = document.createElement('div')
  content.className = 'right-content quiet-scroll'

  function setTab(label) {
    activeTab = label
    seg.querySelectorAll('.right-tab-btn').forEach(b => {
      b.classList.toggle('right-tab-btn--active', b.textContent === label)
    })
    renderContent()
  }

  TABS.forEach(label => {
    const btn = document.createElement('button')
    btn.className = 'right-tab-btn' + (label === activeTab ? ' right-tab-btn--active' : '')
    btn.textContent = label
    btn.addEventListener('click', () => setTab(label))
    seg.appendChild(btn)
  })

  // ── Render dispatcher ───────────────────────────────────────────────────────
  function renderContent() {
    content.innerHTML = ''
    if (activeTab === 'Speakers')  renderSpeakers()
    else if (activeTab === 'Chapters') renderChapters()
    else if (activeTab === 'Notes')    renderNotes()
    else renderActivity()
  }

  // ── Empty state helper ──────────────────────────────────────────────────────
  function emptyState(title, hint = '') {
    const el = document.createElement('div')
    el.className = 'right-empty'
    el.innerHTML = `<div class="right-empty-title">${title}</div>`
    if (hint) {
      const h = document.createElement('div')
      h.style.cssText = 'font-size:11.5px;color:var(--ink-dim);margin-top:4px;line-height:1.45'
      h.textContent = hint
      el.appendChild(h)
    }
    return el
  }

  // ── Speakers tab ────────────────────────────────────────────────────────────
  function renderSpeakers() {
    const durBySpeaker = {}, countBySpeaker = {}, sampleBySpeaker = {}
    let totalDur = 0
    transcript.segments.forEach(seg => {
      const spkId = effectiveSpeaker(seg)
      const d = seg.end - seg.start
      durBySpeaker[spkId] = (durBySpeaker[spkId] || 0) + d
      countBySpeaker[spkId] = (countBySpeaker[spkId] || 0) + 1
      totalDur += d
      if (!sampleBySpeaker[spkId]) sampleBySpeaker[spkId] = seg.text
    })

    const recognized   = Object.keys(durBySpeaker).filter(id => !isUnrecognized(id, knownMap))
    const unrecognized = Object.keys(durBySpeaker).filter(id => isUnrecognized(id, knownMap))

    function sectionLabel(text, count, dot) {
      const lbl = document.createElement('div')
      lbl.className = 'right-section-label'
      lbl.innerHTML = `<span class="right-section-dot" style="background:${dot}"></span>${text}
        <span class="right-section-count">${count}</span>`
      return lbl
    }

    if (recognized.length > 0) {
      content.appendChild(sectionLabel('Recognized', recognized.length, '#30D158'))
      recognized.forEach(spkId => {
        content.appendChild(makeSpeakerCard(
          spkId, knownMap[spkId] || spkId,
          countBySpeaker[spkId], durBySpeaker[spkId],
          totalDur, transcriptId, onReload, knownSpeakers
        ))
      })
    }

    if (unrecognized.length > 0) {
      content.appendChild(sectionLabel('Unrecognized', unrecognized.length, '#FF9F0A'))
      unrecognized.forEach((spkId, i) => {
        const card = makeSpeakerCard(
          spkId, `Unknown speaker ${i + 1}`,
          countBySpeaker[spkId], durBySpeaker[spkId],
          totalDur, transcriptId, onReload, knownSpeakers
        )
        const sample = sampleBySpeaker[spkId]
        if (sample) {
          const quote = document.createElement('div')
          quote.className = 'spk-quote'
          quote.textContent = `"${sample.slice(0, 80)}${sample.length > 80 ? '…' : ''}"`
          card.appendChild(quote)
        }
        content.appendChild(card)
      })
    }

    if (recognized.length === 0 && unrecognized.length === 0) {
      content.appendChild(emptyState('No speakers', 'Transcript has no segments.'))
    }
  }

  // ── Chapters tab ────────────────────────────────────────────────────────────
  function renderChapters() {
    // Group consecutive segments by speaker
    const groups = []
    transcript.segments.forEach(seg => {
      const spkId = effectiveSpeaker(seg)
      const last = groups[groups.length - 1]
      if (last && last.spkId === spkId) {
        last.end = seg.end
        last.count++
      } else {
        groups.push({ spkId, start: seg.start, end: seg.end, count: 1, firstText: seg.text })
      }
    })

    if (groups.length === 0) {
      content.appendChild(emptyState('No chapters', 'Transcript has no segments.'))
      return
    }

    const label = document.createElement('div')
    label.className = 'right-section-label'
    label.style.marginBottom = '8px'
    label.innerHTML = `<span>${groups.length} speaker turn${groups.length !== 1 ? 's' : ''}</span>`
    content.appendChild(label)

    groups.forEach((g, i) => {
      const name = getDisplayName(g.spkId)
      const p = isUnrecognized(g.spkId, knownMap) ? null : speakerPalette(g.spkId)
      const color = p ? p.color : 'var(--ink-dim)'

      const item = document.createElement('button')
      item.style.cssText = [
        'display:grid;grid-template-columns:28px 1fr;gap:8px;align-items:flex-start',
        'width:100%;padding:8px;border-radius:6px;border:none;background:transparent',
        'cursor:pointer;text-align:left;margin-bottom:1px',
      ].join(';')

      const numEl = document.createElement('div')
      numEl.style.cssText = [
        `font-family:var(--mono);font-size:10px;font-weight:600;color:var(--ink-dim)`,
        'font-variant-numeric:tabular-nums;padding-top:2px;text-align:right',
      ].join(';')
      numEl.textContent = String(i + 1).padStart(2, '0')

      const infoEl = document.createElement('div')
      infoEl.style.minWidth = '0'

      const spkRow = document.createElement('div')
      spkRow.style.cssText = 'display:flex;align-items:center;gap:5px;margin-bottom:3px'
      spkRow.innerHTML = `
        <span style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0"></span>
        <span style="font-size:12.5px;font-weight:600;color:${color};letter-spacing:-0.005em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span>
      `

      const metaEl = document.createElement('div')
      metaEl.style.cssText = 'display:flex;gap:5px;font-size:10.5px;color:var(--ink-dim);margin-bottom:4px;font-variant-numeric:tabular-nums'
      metaEl.innerHTML = `<span style="font-family:var(--mono)">${fmtTime(g.start)}</span><span>·</span><span>${fmtTime(g.end - g.start)}</span><span>·</span><span>${g.count} seg</span>`

      const previewEl = document.createElement('div')
      previewEl.style.cssText = 'font-size:11.5px;color:var(--ink-2);line-height:1.45;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical'
      previewEl.textContent = g.firstText.slice(0, 90) + (g.firstText.length > 90 ? '…' : '')

      infoEl.appendChild(spkRow)
      infoEl.appendChild(metaEl)
      infoEl.appendChild(previewEl)

      item.appendChild(numEl)
      item.appendChild(infoEl)

      item.onmouseenter = () => { item.style.background = 'rgba(0,0,0,0.03)' }
      item.onmouseleave = () => { item.style.background = 'transparent' }

      content.appendChild(item)
    })
  }

  // ── Notes tab ───────────────────────────────────────────────────────────────
  function renderNotes() {
    content.appendChild(emptyState(
      'No notes yet',
      'Notes and highlights will appear here in a future update.'
    ))
  }

  // ── Activity tab ────────────────────────────────────────────────────────────
  function renderActivity() {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'padding:4px 0'

    const infoLabel = document.createElement('div')
    infoLabel.className = 'right-section-label'
    infoLabel.style.marginBottom = '10px'
    infoLabel.textContent = 'Recent changes'
    wrap.appendChild(infoLabel)

    // Static entries based on transcript metadata
    const items = [
      { icon: '📝', text: 'Transcript created', when: transcript.created_at ? new Date(transcript.created_at).toLocaleDateString() : 'recently' },
      { icon: '🎙', text: `${transcript.segments.length} segments transcribed`, when: '' },
      { icon: '👥', text: `${new Set(transcript.segments.map(s => effectiveSpeaker(s))).size} speakers identified`, when: '' },
    ]

    items.forEach(it => {
      const row = document.createElement('div')
      row.style.cssText = 'display:flex;gap:9px;padding:7px 4px;border-radius:5px'
      row.innerHTML = `
        <span style="font-size:14px;flex-shrink:0">${it.icon}</span>
        <div style="min-width:0">
          <div style="font-size:12.5px;color:var(--ink);line-height:1.4">${it.text}</div>
          ${it.when ? `<div style="font-size:10.5px;color:var(--ink-dim);margin-top:1px">${it.when}</div>` : ''}
        </div>
      `
      wrap.appendChild(row)
    })

    content.appendChild(wrap)
  }

  panel.appendChild(tabBar)
  panel.appendChild(content)
  renderContent()
  return panel
}

// ── Editor view (main) ─────────────────────────────────────────────────────────
function renderEditorView(transcriptId) {
  const root = document.createElement('div')
  root.className = 'editor-layout'

  const focusPanel = document.createElement('div')
  focusPanel.className = 'focus-panel'

  // Loading state
  const loader = document.createElement('div')
  loader.className = 'editor-loader'
  loader.textContent = 'Loading…'
  focusPanel.appendChild(loader)

  root.appendChild(focusPanel)

  // Persistent audio element — survives rebuilds so playback isn't interrupted
  const audio = new Audio()
  audio.preload = 'metadata'
  let playerAbortCtrl = null
  let rightPanelEl = null

  function makeTagsRow(transcript) {
    const row = document.createElement('div')
    row.className = 'focus-tags'

    const audioPath = transcript.audio_path || ''
    const isLiveRec = audioPath.includes('whisper-rec-')
    const sourceLabel = isLiveRec ? 'live recording' : 'file'

    const srcChip = document.createElement('span')
    srcChip.className = 'focus-tag'
    srcChip.style.cssText = 'background:rgba(10,132,255,0.08);color:var(--accent);border:0.5px solid rgba(10,132,255,0.20)'
    srcChip.textContent = sourceLabel
    row.appendChild(srcChip)

    const addBtn = document.createElement('button')
    addBtn.className = 'focus-tag focus-tag--add'
    addBtn.textContent = '+ tag'
    addBtn.addEventListener('click', () => window.showToast?.('Tags coming in a future update'))
    row.appendChild(addBtn)

    return row
  }

  function buildEditor(transcript, knownSpeakers) {
    focusPanel.innerHTML = ''

    // Load audio (set src only if changed)
    const audioSrc = 'file://' + transcript.audio_path
    if (audio.src !== audioSrc) audio.src = audioSrc

    // Abort previous player bar audio listeners
    if (playerAbortCtrl) playerAbortCtrl.abort()
    playerAbortCtrl = new AbortController()

    // Known speaker map for display names
    const knownMap = {}
    knownSpeakers.forEach(s => { knownMap[s.id] = s.name })

    function displayName(spkId) {
      if (knownMap[spkId]) return knownMap[spkId]
      // Stable "Unknown N": rank by first appearance time, ascending
      const firstSeen = {}
      transcript.segments.forEach(s => {
        const id = effectiveSpeaker(s)
        if (isUnrecognized(id, knownMap) && !(id in firstSeen)) firstSeen[id] = s.start
      })
      const unrecognizedIds = Object.keys(firstSeen).sort((a, b) => firstSeen[a] - firstSeen[b])
      const n = unrecognizedIds.indexOf(spkId) + 1
      return n > 0 ? `Unknown ${n}` : spkId
    }

    function reload() {
      Promise.all([
        fetch(`${API_BASE}/transcripts/${transcriptId}`).then(r => r.json()),
        fetch(`${API_BASE}/speakers`).then(r => r.json()),
      ]).then(([t, spks]) => buildEditor(t, spks))
    }

    // ── Top bar ──────────────────────────────────────────────────────────────
    const topBar = document.createElement('div')
    topBar.className = 'focus-topbar'

    const breadcrumb = document.createElement('div')
    breadcrumb.className = 'focus-breadcrumb'
    breadcrumb.innerHTML = `<span>Transcripts</span>
      <svg width="6" height="9" viewBox="0 0 6 9" fill="none">
        <path d="M1 1l3 3.5L1 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>${new Date().toLocaleDateString('en', { month:'short', day:'numeric' })}</span>`

    const titleRow = document.createElement('div')
    titleRow.className = 'focus-title-row'

    const stem = transcript.audio_path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '')
    const title = document.createElement('h1')
    title.className = 'focus-title'
    title.textContent = stem.replace(/[_-]/g, ' ')

    titleRow.appendChild(title)

    const metaRow = document.createElement('div')
    metaRow.className = 'focus-meta'
    metaRow.textContent = `${transcript.language.toUpperCase()}  ·  ${transcript.segments.length} segments`

    topBar.appendChild(breadcrumb)
    topBar.appendChild(titleRow)
    topBar.appendChild(metaRow)
    topBar.appendChild(makeTagsRow(transcript))

    // ── Segment list ──────────────────────────────────────────────────────────
    const segList = document.createElement('div')
    segList.className = 'seg-list quiet-scroll'

    let prevSpkId = null
    transcript.segments.forEach((seg, i) => {
      const spkId = effectiveSpeaker(seg)
      const row = makeSegmentRow(seg, transcriptId, displayName(spkId), reload, knownMap, knownSpeakers, audio)
      if (i > 0 && spkId !== prevSpkId) row.classList.add('seg-row--speaker-break')
      prevSpkId = spkId
      segList.appendChild(row)
    })

    // Wire playing indicator
    audio.addEventListener('timeupdate', () => {
      const t = audio.currentTime
      segList.querySelectorAll('.seg-row').forEach(r => {
        const start = parseFloat(r.dataset.start)
        const end   = parseFloat(r.dataset.end || '9999')
        r.classList.toggle('seg-row--playing', t >= start && t < end)
      })
    }, { signal: playerAbortCtrl.signal })

    // ── Selection toolbar ─────────────────────────────────────────────────────
    segList.dataset.stream = 'true'

    const selToolbar = document.createElement('div')
    selToolbar.className = 'sel-toolbar'
    selToolbar.style.display = 'none'

    function hideSelToolbar() { selToolbar.style.display = 'none' }

    const SEL_ACTIONS = [
      {
        label: 'Copy',
        icon: `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M3 8.5H2A1.5 1.5 0 0 1 .5 7V2A1.5 1.5 0 0 1 2 .5h5A1.5 1.5 0 0 1 8.5 2v1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
        action() {
          const text = window.getSelection()?.toString()
          if (text) navigator.clipboard.writeText(text)
            .then(() => window.showToast?.('Copied'))
            .catch(() => window.showToast?.('Copy failed'))
          hideSelToolbar()
          window.getSelection()?.removeAllRanges()
        }
      },
      {
        label: 'Quote',
        icon: `<svg width="13" height="11" viewBox="0 0 13 11" fill="none"><path d="M1 1h4v4H1V1zM8 1h4v4H8V1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M1 5c0 2 1.5 4 4 5M8 5c0 2 1.5 4 4 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
        action() {
          const text = window.getSelection()?.toString()
          if (text) navigator.clipboard.writeText(`"${text}"`)
            .then(() => window.showToast?.('Quote copied'))
            .catch(() => window.showToast?.('Copy failed'))
          hideSelToolbar()
          window.getSelection()?.removeAllRanges()
        }
      },
      {
        label: 'Edit',
        icon: `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M9.5 1.5l2 2-7 7-2.5.5.5-2.5 7-7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
        action() {
          const sel = window.getSelection()
          const el = sel?.anchorNode?.parentElement?.closest('.seg-row')
          if (el) el.querySelector('.seg-text')?.click()
          hideSelToolbar()
        }
      },
    ]

    SEL_ACTIONS.forEach((item, i) => {
      if (i > 0) {
        const sep = document.createElement('div')
        sep.className = 'sel-toolbar-sep'
        selToolbar.appendChild(sep)
      }
      const btn = document.createElement('button')
      btn.className = 'sel-action-btn'
      btn.innerHTML = item.icon + `<span>${item.label}</span>`
      btn.addEventListener('mousedown', e => e.preventDefault())
      btn.addEventListener('click', item.action)
      selToolbar.appendChild(btn)
    })

    function onMouseUp() {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) { hideSelToolbar(); return }
      const anchor = sel.anchorNode
      if (!anchor) { hideSelToolbar(); return }
      const el = anchor.nodeType === 1 ? anchor : anchor.parentElement
      if (!el?.closest('[data-stream]')) { hideSelToolbar(); return }

      const range = sel.getRangeAt(0)
      const rRect = range.getBoundingClientRect()
      const pRect = focusPanel.getBoundingClientRect()
      if (rRect.width < 4) { hideSelToolbar(); return }

      selToolbar.style.display = 'inline-flex'
      const tbW = selToolbar.offsetWidth || 200
      const tbH = selToolbar.offsetHeight || 34
      const x = rRect.left + rRect.width / 2 - pRect.left - tbW / 2
      const y = rRect.top - pRect.top - tbH - 10

      selToolbar.style.left = Math.max(8, Math.min(x, pRect.width - tbW - 8)) + 'px'
      selToolbar.style.top  = Math.max(8, y) + 'px'
    }

    function onSelectionChange() {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) hideSelToolbar()
    }

    document.addEventListener('mouseup', onMouseUp, { signal: playerAbortCtrl.signal })
    document.addEventListener('selectionchange', onSelectionChange, { signal: playerAbortCtrl.signal })

    focusPanel.appendChild(topBar)
    focusPanel.appendChild(segList)
    focusPanel.appendChild(selToolbar)
    focusPanel.appendChild(makePlayerBar(transcript, audio, playerAbortCtrl.signal, knownSpeakers))

    // ── Right panel ───────────────────────────────────────────────────────────
    if (rightPanelEl) rightPanelEl.remove()
    rightPanelEl = makeRightPanel(transcript, knownSpeakers, transcriptId, reload)
    root.appendChild(rightPanelEl)
  }

  // Initial load
  Promise.all([
    fetch(`${API_BASE}/transcripts/${transcriptId}`).then(r => {
      if (!r.ok) throw new Error(r.status)
      return r.json()
    }),
    fetch(`${API_BASE}/speakers`).then(r => r.json()),
  ])
    .then(([transcript, speakers]) => buildEditor(transcript, speakers))
    .catch(err => {
      focusPanel.innerHTML = ''
      const errEl = document.createElement('div')
      errEl.className = 'editor-loader'
      errEl.textContent = `Failed to load: ${err.message}`
      focusPanel.appendChild(errEl)
    })

  return root
}
