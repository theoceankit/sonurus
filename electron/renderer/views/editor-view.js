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

  function makeActionBtn(tooltip, svgHtml, extraClass) {
    const btn = document.createElement('button')
    btn.className = 'seg-action-btn' + (extraClass ? ' ' + extraClass : '')
    btn.setAttribute('data-tooltip', tooltip)
    btn.innerHTML = svgHtml
    attachSegTooltip(btn)
    return btn
  }

  const playBtn = makeActionBtn('Play segment', `<svg width="9" height="11" viewBox="0 0 9 11" fill="none">
    <path d="M1.5 1.2L7.5 5.5 1.5 9.8V1.2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  </svg>`)

  const editBtn = makeActionBtn('Edit segment', `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2 8.5L8 2.5 9.5 4 3.5 10H2V8.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M7 3.5L8.5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`)

  const bookmarkBtn = makeActionBtn('Save for later', `<svg width="10" height="12" viewBox="0 0 11 13" fill="none">
    <path d="M1.5 1.5h8v10l-4-2.5-4 2.5v-10z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  </svg>`)

  const copyBtn = makeActionBtn('Copy segment', `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
    <path d="M7.5 4V2A1.5 1.5 0 006 .5H2A1.5 1.5 0 00.5 2v4A1.5 1.5 0 002 7.5h2" stroke="currentColor" stroke-width="1.2"/>
  </svg>`)

  const deleteBtn = makeActionBtn('Delete segment', `<svg width="11" height="12" viewBox="0 0 11 12" fill="none">
    <rect x="1" y="3" width="9" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
    <path d="M3.5 3V2a1 1 0 011-1h2a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.2"/>
    <line x1="0.5" y1="3" x2="10.5" y2="3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    <line x1="4" y1="5.5" x2="4" y2="9.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
    <line x1="7" y1="5.5" x2="7" y2="9.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
  </svg>`, 'seg-action-btn--danger')

  playBtn.addEventListener('click', () => { if (audio) { audio.currentTime = seg.start; audio.play() } })
  editBtn.addEventListener('click', () => enterEditMode())
  bookmarkBtn.addEventListener('click', () => window.showToast?.('Bookmarks coming in a future update'))
  copyBtn.addEventListener('click', () =>
    navigator.clipboard.writeText(seg.text)
      .then(() => window.showToast?.('Copied to clipboard'))
      .catch(() => window.showToast?.('Copy failed'))
  )
  deleteBtn.addEventListener('click', () => {
    fetch(`${API_BASE}/transcripts/${transcriptId}/segments/${seg.start}`, { method: 'DELETE' })
      .then(r => { if (!r.ok) throw new Error(r.status) })
      .then(() => { row.style.opacity = '0'; row.style.transition = 'opacity 0.15s'; setTimeout(() => { row.remove(); onReload() }, 150) })
  })

  actions.appendChild(playBtn)
  actions.appendChild(editBtn)
  actions.appendChild(bookmarkBtn)
  actions.appendChild(copyBtn)
  actions.appendChild(deleteBtn)

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

  row.dataset.edit = ''  // marker for selection toolbar

  editArea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit() }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
  })

  return row
}

// ── Speaker card (right panel) ─────────────────────────────────────────────────
function makeSpeakerCard(spkId, displayName, segCount, totalSec, transcriptDurSec, transcriptId, onReload, knownSpeakers = [], sample = null) {
  const _knownMap = {}
  knownSpeakers.forEach(s => { _knownMap[s.id] = s.name })
  const unrecognized = isUnrecognized(spkId, _knownMap)
  const p = unrecognized ? null : speakerPalette(spkId)

  const card = document.createElement('div')
  card.className = unrecognized ? 'spk-card spk-card--unknown' : 'spk-card'

  if (unrecognized) {
    // ── Unrecognized layout ─────────────────────────────────────────────────
    // Header: [avatar] [name + meta] [play btn]  — all vertically centered
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
    metaEl.textContent = `${segCount} segments  ${fmtTime(totalSec)}`

    info.appendChild(nameEl)
    info.appendChild(metaEl)

    const playBtn = document.createElement('button')
    playBtn.className = 'spk-card-play-btn'
    playBtn.innerHTML = `<svg width="8" height="10" viewBox="0 0 9 11" fill="none">
      <path d="M1.5 1.2L7.5 5.5 1.5 9.8V1.2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>`

    top.appendChild(avatar)
    top.appendChild(info)
    top.appendChild(playBtn)
    card.appendChild(top)

    // Quote
    if (sample) {
      const quote = document.createElement('div')
      quote.className = 'spk-quote'
      const quoteIcon = document.createElement('span')
      quoteIcon.className = 'spk-quote-icon'
      quoteIcon.setAttribute('aria-hidden', 'true')
      quoteIcon.textContent = '“'
      const quoteText = document.createElement('span')
      quoteText.className = 'spk-quote-text'
      quoteText.textContent = `${sample.slice(0, 80)}${sample.length > 80 ? '…' : ''}`
      quote.appendChild(quoteIcon)
      quote.appendChild(quoteText)
      card.appendChild(quote)
    }

    // Suggestion (mocked)
    const mockSuggestion = knownSpeakers[0] || null
    if (mockSuggestion) {
      const p = speakerPalette(mockSuggestion.id)
      const sugg = document.createElement('div')
      sugg.className = 'spk-suggestion'
      sugg.style.background = p.bg
      sugg.style.border = `0.5px solid ${p.color}40`

      const dot = document.createElement('span')
      dot.className = 'spk-suggestion-dot'
      dot.style.background = p.color

      const txt = document.createElement('span')
      txt.className = 'spk-suggestion-text'
      txt.innerHTML = `Likely <span class="spk-suggestion-name" style="color:${p.color}">${mockSuggestion.name}</span><span class="spk-suggestion-pct">87%</span>`

      const btns = document.createElement('div')
      btns.className = 'spk-suggestion-btns'

      const confirmBtn = document.createElement('button')
      confirmBtn.className = 'spk-suggestion-btn spk-suggestion-btn--confirm'
      confirmBtn.style.background = p.color
      confirmBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`

      const rejectBtn = document.createElement('button')
      rejectBtn.className = 'spk-suggestion-btn spk-suggestion-btn--reject'
      rejectBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 12 12" fill="none">
        <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>`

      btns.appendChild(confirmBtn)
      btns.appendChild(rejectBtn)
      sugg.appendChild(dot)
      sugg.appendChild(txt)
      sugg.appendChild(btns)
      card.appendChild(sugg)
    }

    // Assign speaker button
    const assignBtn = document.createElement('button')
    assignBtn.className = 'spk-assign-btn'
    assignBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <line x1="19" y1="8" x2="19" y2="14"/>
      <line x1="22" y1="11" x2="16" y2="11"/>
    </svg>Assign speaker`
    assignBtn.addEventListener('click', e => {
      e.stopPropagation()
      showSpeakerPicker(assignBtn, spkId, knownSpeakers, transcriptId, onReload)
    })
    card.appendChild(assignBtn)

    return card
  }

  // ── Recognized layout ───────────────────────────────────────────────────
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
  metaEl.textContent = `${segCount} segments  ${fmtTime(totalSec)}`

  info.appendChild(nameEl)
  info.appendChild(metaEl)

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
  cardActions.appendChild(reassignCardBtn)

  top.appendChild(avatar)
  top.appendChild(info)
  top.appendChild(cardActions)
  card.appendChild(top)

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
  const tipTime = document.createElement('span')
  tipTime.className = 'waveform-tip-time'
  const tipName = document.createElement('span')
  tipName.className = 'waveform-tip-name'
  scrubTip.appendChild(tipTime)
  scrubTip.appendChild(tipName)
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

  let hoveredSeg = null

  function updateFill() {
    if (!audio.duration) return
    const filled = (audio.currentTime / audio.duration) * BARS
    barEls.forEach((bar, i) => {
      const t = (i + 0.5) / BARS * audio.duration
      const inHovered = hoveredSeg && t >= hoveredSeg.start && t < hoveredSeg.end
      bar.style.opacity = (i <= filled || inHovered) ? '1' : '0.32'
    })
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

    const seg = segs.find(s => t >= s.start && t < s.end) || null
    tipTime.textContent = fmtTime(t)

    if (seg !== hoveredSeg) {
      hoveredSeg = seg
      updateFill()
    }

    if (seg) {
      const spkId = effectiveSpeaker(seg)
      tipName.textContent = knownMap[spkId] || 'Unknown speaker'
      tipName.style.display = 'block'
    } else {
      tipName.style.display = 'none'
    }

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
      hoveredSeg = null
      updateFill()
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
  const SPEEDS = [1, 1.2, 1.5, 2]
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
  const volWrap = document.createElement('div')
  volWrap.className = 'vol-wrap'

  const volBtn = makeBtn(I_VOLUME)
  audio.volume = 0.8

  const volPopup = document.createElement('div')
  volPopup.className = 'vol-popup'

  const volSlider = document.createElement('input')
  volSlider.type = 'range'
  volSlider.min = '0'
  volSlider.max = '1'
  volSlider.step = '0.02'
  volSlider.value = String(audio.volume)
  volSlider.addEventListener('input', () => {
    audio.volume = parseFloat(volSlider.value)
    audio.muted = audio.volume === 0
    volBtn.style.opacity = audio.volume === 0 ? '0.4' : '1'
  })

  volPopup.appendChild(volSlider)
  volWrap.appendChild(volBtn)
  volWrap.appendChild(volPopup)

  volBtn.addEventListener('click', () => {
    volPopup.classList.toggle('vol-popup--open')
  })
  document.addEventListener('click', e => {
    if (!volWrap.contains(e.target)) volPopup.classList.remove('vol-popup--open')
  }, { signal })

  bar.appendChild(controls)
  bar.appendChild(elapsed)
  bar.appendChild(waveform)
  bar.appendChild(total)
  bar.appendChild(speedBtn)
  bar.appendChild(volWrap)

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

    function sectionLabel(text, count) {
      const lbl = document.createElement('div')
      lbl.className = 'right-section-label'
      lbl.innerHTML = `${text}<span class="right-section-count">${count}</span>`
      return lbl
    }

    if (recognized.length > 0) {
      content.appendChild(sectionLabel('Recognized', recognized.length))
      recognized.forEach(spkId => {
        content.appendChild(makeSpeakerCard(
          spkId, knownMap[spkId] || spkId,
          countBySpeaker[spkId], durBySpeaker[spkId],
          totalDur, transcriptId, onReload, knownSpeakers
        ))
      })
    }

    if (unrecognized.length > 0) {
      content.appendChild(sectionLabel('Unrecognized', unrecognized.length))
      unrecognized.forEach((spkId, i) => {
        const card = makeSpeakerCard(
          spkId, `Unknown speaker ${i + 1}`,
          countBySpeaker[spkId], durBySpeaker[spkId],
          totalDur, transcriptId, onReload, knownSpeakers,
          sampleBySpeaker[spkId] || null
        )
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
function fmtCreatedAt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const day = d.getDate()
  const month = d.toLocaleDateString('en-US', { month: 'short' })
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${day} ${month}  ${h}:${m}`
}

function renderEditorView(transcriptId, meta = null) {
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
    srcChip.style.cssText = ''
    srcChip.textContent = sourceLabel
    row.appendChild(srcChip)

    const addBtn = document.createElement('button')
    addBtn.className = 'focus-tag focus-tag--add'
    addBtn.textContent = '+ tag'
    addBtn.addEventListener('click', () => window.showToast?.('Tags coming in a future update'))
    row.appendChild(addBtn)

    return row
  }

  function buildEditor(transcript, knownSpeakers, meta = null) {
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
      ]).then(([t, spks]) => buildEditor(t, spks, meta))
    }

    // ── Top bar ──────────────────────────────────────────────────────────────
    const topBar = document.createElement('div')
    topBar.className = 'focus-topbar'

    // Date line
    const dateStr = fmtCreatedAt(meta?.created_at)
    if (dateStr) {
      const dateEl = document.createElement('div')
      dateEl.className = 'focus-date'
      dateEl.textContent = dateStr
      topBar.appendChild(dateEl)
    }

    // Title
    const titleRow = document.createElement('div')
    titleRow.className = 'focus-title-row'

    const titleText = meta?.title
      || transcript.audio_path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ')
    const title = document.createElement('h1')
    title.className = 'focus-title'
    title.textContent = titleText

    titleRow.appendChild(title)
    topBar.appendChild(titleRow)

    // Meta row: speaker avatars + count + language
    const metaRow = document.createElement('div')
    metaRow.className = 'focus-meta'

    const uniqueSpkIds = [...new Set(transcript.segments.map(s => effectiveSpeaker(s)))]
    if (uniqueSpkIds.length > 0) {
      const avatarGroup = document.createElement('div')
      avatarGroup.className = 'focus-avatar-group'
      uniqueSpkIds.slice(0, 5).forEach(spkId => {
        const name = displayName(spkId)
        const known = !isUnrecognized(spkId, knownMap)
        const av = document.createElement('div')
        av.className = 'focus-header-av' + (known ? '' : ' focus-header-av--unknown')
        if (known) {
          const p = speakerPalette(spkId)
          av.style.background = p.color
        }
        av.textContent = known ? speakerInitials(name) : '?'
        av.title = name
        avatarGroup.appendChild(av)
      })
      metaRow.appendChild(avatarGroup)
    }

    const metaText = document.createElement('span')
    metaText.className = 'focus-meta-text'
    const spkCount = uniqueSpkIds.length
    const lang = transcript.language
    const langLabel = (lang && lang !== 'unknown' && lang !== 'Unknown')
      ? lang.charAt(0).toUpperCase() + lang.slice(1)
      : ''
    metaText.textContent = `${spkCount} speaker${spkCount !== 1 ? 's' : ''}` + (langLabel ? `  ·  ${langLabel}` : '')
    metaRow.appendChild(metaText)

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
        label: 'Highlight',
        icon: `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 10.5h9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M8.5 2L11 4.5l-5 5-3 .5.5-3 5-5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
        action() {
          hideSelToolbar()
          window.showToast?.('Highlights coming in a future update')
          window.getSelection()?.removeAllRanges()
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
      if (el?.closest('.seg-row--editing')) { hideSelToolbar(); return }

      const range = sel.getRangeAt(0)
      const rRect = range.getBoundingClientRect()
      if (rRect.width < 4) { hideSelToolbar(); return }

      selToolbar.style.display = 'inline-flex'
      const tbW = selToolbar.offsetWidth || 200
      const tbH = selToolbar.offsetHeight || 34
      const x = rRect.left + rRect.width / 2 - tbW / 2
      const y = rRect.top - tbH - 10

      selToolbar.style.left = Math.max(8, Math.min(x, window.innerWidth - tbW - 8)) + 'px'
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

    const playerSlot = document.getElementById('player-slot')
    playerSlot.replaceChildren(makePlayerBar(transcript, audio, playerAbortCtrl.signal, knownSpeakers))

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
    .then(([transcript, speakers]) => buildEditor(transcript, speakers, meta))
    .catch(err => {
      focusPanel.innerHTML = ''
      const errEl = document.createElement('div')
      errEl.className = 'editor-loader'
      errEl.textContent = `Failed to load: ${err.message}`
      focusPanel.appendChild(errEl)
    })

  return root
}
