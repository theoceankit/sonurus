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

function attachSegTooltip(btn, placement = 'above') {
  btn.addEventListener('mouseenter', () => {
    const text = btn.getAttribute('data-tooltip')
    if (!text) return
    const tt = _getTooltip()
    tt.textContent = text
    tt.classList.remove('seg-tooltip--visible', 'seg-tooltip--below')
    tt.style.left = '-10499px'
    tt.style.top = '-10499px'

    requestAnimationFrame(() => {
      const bRect = btn.getBoundingClientRect()
      const tRect = tt.getBoundingClientRect()
      const idealLeft = bRect.left + bRect.width / 2 - tRect.width / 2
      const left = Math.max(8, Math.min(idealLeft, window.innerWidth - tRect.width - 8))
      const top = placement === 'below'
        ? bRect.bottom + 8
        : bRect.top - tRect.height - 8

      const arrowLeft = bRect.left + bRect.width / 2 - left
      tt.style.setProperty('--arrow-left', arrowLeft + 'px')
      tt.style.left = left + 'px'
      tt.style.top = top + 'px'
      if (placement === 'below') tt.classList.add('seg-tooltip--below')
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

  // Search row
  const searchWrap = document.createElement('div')
  searchWrap.className = 'spk-picker-search-wrap'

  const searchIcon = document.createElement('span')
  searchIcon.className = 'spk-picker-search-icon'
  searchIcon.innerHTML = `<svg width="11" height="11" viewBox="0 0 13 13" fill="none">
    <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.4"/>
    <path d="M8.5 8.5l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`

  const search = document.createElement('input')
  search.className = 'spk-picker-search'
  search.placeholder = 'Search speakers'

  const clearBtn = document.createElement('button')
  clearBtn.className = 'spk-picker-clear'
  clearBtn.style.display = 'none'
  clearBtn.innerHTML = `<svg width="6" height="6" viewBox="0 0 6 6" fill="none">
    <path d="M1 1l4 4M5 1L1 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`
  clearBtn.addEventListener('mousedown', e => {
    e.preventDefault()
    search.value = ''
    clearBtn.style.display = 'none'
    buildList('', 0)
    search.focus()
  })

  searchWrap.appendChild(searchIcon)
  searchWrap.appendChild(search)
  searchWrap.appendChild(clearBtn)
  popup.appendChild(searchWrap)

  // List
  const list = document.createElement('div')
  list.className = 'spk-picker-list'
  popup.appendChild(list)

  // Footer: separator + add new speaker
  const footer = document.createElement('div')
  footer.className = 'spk-picker-footer'

  const sep = document.createElement('div')
  sep.className = 'spk-picker-sep'
  footer.appendChild(sep)

  const newBtn = document.createElement('button')
  newBtn.className = 'spk-picker-new-btn'

  const newAv = document.createElement('span')
  newAv.className = 'spk-picker-new-av'
  newAv.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`

  const newLabel = document.createElement('span')
  newLabel.className = 'spk-picker-new-label'

  function updateNewLabel(q) {
    newLabel.innerHTML = ''
    newLabel.append('Add new speaker ')
    const nameSpan = document.createElement('span')
    nameSpan.className = 'spk-picker-new-name'
    nameSpan.textContent = q.trim() ? `"${q.trim()}"` : '"Speaker"'
    newLabel.appendChild(nameSpan)
  }
  updateNewLabel('')

  newBtn.appendChild(newAv)
  newBtn.appendChild(newLabel)
  footer.appendChild(newBtn)
  popup.appendChild(footer)

  newBtn.addEventListener('mousedown', e => {
    e.preventDefault()
    const name = search.value.trim() || 'Speaker'
    fetch(`${API_BASE}/transcripts/${transcriptId}/reassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_speaker_id: currentSpkId, to_speaker_name: name }),
    })
      .then(r => { if (!r.ok) throw new Error(r.status); popup.remove(); onReload() })
      .catch(err => window.showToast?.(`Failed to reassign speaker: ${err.message}`, 'error'))
  })

  let focusIdx = 0

  function buildList(filter, newFocusIdx = 0) {
    list.innerHTML = ''
    const q = filter.trim().toLowerCase()
    const filtered = q
      ? knownSpeakers.filter(s => s.name.toLowerCase().includes(q))
      : knownSpeakers
    const items = q
      ? filtered
      : [...filtered].sort((a, b) => (b.id === currentSpkId) - (a.id === currentSpkId))
    focusIdx = Math.max(0, Math.min(newFocusIdx, items.length - 1))

    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'spk-picker-empty'
      empty.textContent = `No speakers match "${filter}"`
      list.appendChild(empty)
      return
    }

    items.forEach((s, i) => {
      const row = document.createElement('button')
      row.className = 'spk-picker-item'
      if (s.id === currentSpkId) row.classList.add('spk-picker-item--current')
      if (i === focusIdx) row.classList.add('spk-picker-item--focused')

      const av = document.createElement('div')
      av.className = 'spk-picker-av'
      const p = speakerPalette(s.id)
      av.style.background = p.color
      av.textContent = speakerInitials(s.name)

      const nm = document.createElement('span')
      nm.className = 'spk-picker-item-name'
      nm.textContent = s.name

      row.appendChild(av)
      row.appendChild(nm)

      if (s.id === currentSpkId) {
        const check = document.createElement('span')
        check.className = 'spk-picker-check'
        check.innerHTML = `<svg width="11" height="9" viewBox="0 0 11 9" fill="none">
          <path d="M1 4.5l3 3 6-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`
        row.appendChild(check)
      }

      row.addEventListener('mouseenter', () => {
        focusIdx = i
        list.querySelectorAll('.spk-picker-item--focused').forEach(el => el.classList.remove('spk-picker-item--focused'))
        row.classList.add('spk-picker-item--focused')
      })
      row.addEventListener('mousedown', e => {
        e.preventDefault()
        if (s.id === currentSpkId) { popup.remove(); return }
        assignSpeaker(s.id)
      })
      list.appendChild(row)
    })
  }

  function assignSpeaker(spkId) {
    const isSingle = segmentStart !== null
    const url = isSingle
      ? `${API_BASE}/transcripts/${transcriptId}/segments/${segmentStart}/speaker`
      : `${API_BASE}/transcripts/${transcriptId}/reassign`
    const body = isSingle
      ? JSON.stringify({ speaker_id: spkId })
      : JSON.stringify({ from_speaker_id: currentSpkId, to_speaker_id: spkId })
    fetch(url, { method: isSingle ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .then(r => { if (!r.ok) throw new Error(r.status); popup.remove(); onReload() })
      .catch(err => window.showToast?.(`Failed to assign speaker: ${err.message}`, 'error'))
  }

  buildList('')

  search.addEventListener('input', () => {
    clearBtn.style.display = search.value ? '' : 'none'
    updateNewLabel(search.value)
    buildList(search.value, 0)
  })

  search.addEventListener('keydown', e => {
    const items = [...list.querySelectorAll('.spk-picker-item')]
    if (e.key === 'Escape') { e.preventDefault(); popup.remove(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusIdx = Math.min(focusIdx + 1, items.length - 1)
      items.forEach((el, i) => el.classList.toggle('spk-picker-item--focused', i === focusIdx))
      items[focusIdx]?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusIdx = Math.max(focusIdx - 1, 0)
      items.forEach((el, i) => el.classList.toggle('spk-picker-item--focused', i === focusIdx))
      items[focusIdx]?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const focused = items[focusIdx]
      if (focused) focused.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    }
  })

  document.body.appendChild(popup)

  requestAnimationFrame(() => {
    const rect = anchorEl.getBoundingClientRect()
    const pw = popup.offsetWidth || 260
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - pw - 8))
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

  const dot = document.createElement('div')
  dot.className = 'seg-spk-av'
  if (p) {
    dot.style.background = p.color
    dot.textContent = speakerInitials(displayName)
  } else {
    dot.style.background = 'color-mix(in srgb, black 8%, var(--panel-bg))'
    dot.style.color = 'var(--ink-dim)'
    dot.textContent = '?'
  }

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

  const editFooter = document.createElement('div')
  editFooter.className = 'seg-edit-footer'

  const editHint = document.createElement('div')
  editHint.className = 'seg-edit-hint'
  editHint.textContent = '⌘↵ to save · esc to cancel'

  const btnConfirm = document.createElement('button')
  btnConfirm.className = 'seg-edit-btn seg-edit-btn--confirm'
  btnConfirm.title = 'Save (⌘↵)'
  btnConfirm.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'

  const btnCancel = document.createElement('button')
  btnCancel.className = 'seg-edit-btn seg-edit-btn--cancel'
  btnCancel.title = 'Cancel (Esc)'
  btnCancel.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'

  editFooter.appendChild(editHint)
  editFooter.appendChild(btnCancel)
  editFooter.appendChild(btnConfirm)

  editWrap.appendChild(editArea)
  editWrap.appendChild(editFooter)

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
    deleteBtn.disabled = true
    fetch(`${API_BASE}/transcripts/${transcriptId}/segments/${seg.start}`, { method: 'DELETE' })
      .then(r => { if (!r.ok) throw new Error(r.status) })
      .then(() => { row.style.opacity = '0'; row.style.transition = 'opacity 0.15s'; setTimeout(() => { row.remove(); onReload() }, 150) })
      .catch(err => { deleteBtn.disabled = false; window.showToast?.(`Failed to delete segment: ${err.message}`, 'error') })
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
      .catch(err => { window.showToast?.(`Failed to save edit: ${err.message}`, 'error'); cancelEdit() })
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

  // mousedown+preventDefault keeps focus on editArea so blur doesn't fire before click
  btnConfirm.addEventListener('mousedown', e => e.preventDefault())
  btnConfirm.addEventListener('click', () => commitEdit())
  btnCancel.addEventListener('mousedown', e => e.preventDefault())
  btnCancel.addEventListener('click', () => cancelEdit())

  editArea.addEventListener('blur', () => cancelEdit())

  return row
}

// ── Speaker card (right panel) ─────────────────────────────────────────────────
function makeSpeakerCard(spkId, displayName, segCount, totalSec, transcriptDurSec, transcriptId, onReload, knownSpeakers = [], sample = null, onPreviewPlay = null, onPreviewPause = null, suggestion = null) {
  const SVG_PLAY_SM  = `<svg width="8" height="10" viewBox="0 0 11 12" fill="none"><path d="M1 1l9 5-9 5V1z" fill="currentColor"/></svg>`
  const SVG_PAUSE_SM = `<svg width="8" height="10" viewBox="0 0 11 12" fill="none"><rect x="1" y="1" width="3" height="10" rx="0.7" fill="currentColor"/><rect x="7" y="1" width="3" height="10" rx="0.7" fill="currentColor"/></svg>`
  const SVG_PLAY_MD  = `<svg width="9" height="11" viewBox="0 0 11 12" fill="none"><path d="M1 1l9 5-9 5V1z" fill="currentColor"/></svg>`
  const SVG_PAUSE_MD = `<svg width="9" height="11" viewBox="0 0 11 12" fill="none"><rect x="1" y="1" width="3" height="10" rx="0.7" fill="currentColor"/><rect x="7" y="1" width="3" height="10" rx="0.7" fill="currentColor"/></svg>`

  function makeToggle(btn, playSvg, pauseSvg) {
    let active = false
    function setActive(val) { active = val; btn.innerHTML = val ? pauseSvg : playSvg }
    btn.addEventListener('click', () => {
      if (active) { onPreviewPause?.(); setActive(false) }
      else { onPreviewPlay?.(setActive) }
    })
  }
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
    playBtn.innerHTML = SVG_PLAY_SM
    makeToggle(playBtn, SVG_PLAY_SM, SVG_PAUSE_SM)

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

    if (suggestion) {
      const p = speakerPalette(suggestion.speaker_id)
      const pct = Math.round(suggestion.score * 100)

      const sugg = document.createElement('div')
      sugg.className = 'spk-suggestion'
      sugg.style.background = p.bg
      sugg.style.border = `0.5px solid ${p.color}40`

      const dot = document.createElement('span')
      dot.className = 'spk-suggestion-dot'
      dot.style.background = p.color

      const txt = document.createElement('span')
      txt.className = 'spk-suggestion-text'
      txt.appendChild(document.createTextNode('Likely '))
      const nameSpan = document.createElement('span')
      nameSpan.className = 'spk-suggestion-name'
      nameSpan.style.color = p.color
      nameSpan.textContent = suggestion.name
      txt.appendChild(nameSpan)
      const pctSpan = document.createElement('span')
      pctSpan.className = 'spk-suggestion-pct'
      pctSpan.textContent = `${pct}%`
      txt.appendChild(pctSpan)

      const btns = document.createElement('div')
      btns.className = 'spk-suggestion-btns'

      const confirmBtn = document.createElement('button')
      confirmBtn.className = 'spk-suggestion-btn spk-suggestion-btn--confirm'
      confirmBtn.style.background = p.color
      confirmBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`
      confirmBtn.addEventListener('click', e => {
        e.stopPropagation()
        confirmBtn.disabled = true
        fetch(`${API_BASE}/transcripts/${transcriptId}/reassign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from_speaker_id: spkId, to_speaker_id: suggestion.speaker_id }),
        })
          .then(r => { if (!r.ok) throw new Error(r.status); onReload() })
          .catch(err => { confirmBtn.disabled = false; window.showToast?.(`Failed to confirm suggestion: ${err.message}`, 'error') })
      })

      const rejectBtn = document.createElement('button')
      rejectBtn.className = 'spk-suggestion-btn spk-suggestion-btn--reject'
      rejectBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 12 12" fill="none">
        <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>`
      rejectBtn.addEventListener('click', e => { e.stopPropagation(); sugg.remove() })

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

  const avatar = makeAvatar(spkId, displayName, 28, _knownMap)
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
  playCardBtn.innerHTML = SVG_PLAY_MD
  attachSegTooltip(playCardBtn)
  makeToggle(playCardBtn, SVG_PLAY_MD, SVG_PAUSE_MD)

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

  const DEFAULT_BAR_COLOR = 'rgba(0,0,0,0.20)'

  const wrap = document.createElement('div')
  wrap.className = 'waveform'

  // Canvas for crisp, gap-free rendering with pill-shaped bars
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;'
  wrap.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  const colors = new Array(BARS).fill(null)
  let hoveredSeg = null

  function render() {
    const W = canvas.width, H = canvas.height
    if (!W || !H) return
    ctx.clearRect(0, 0, W, H)

    const dpr = window.devicePixelRatio || 1
    const filled = audio.duration ? (audio.currentTime / audio.duration) * BARS : -1
    const slotW = W / BARS
    const gap = dpr                        // 1 CSS px gap between bars
    const bw = Math.max(1, slotW - gap)
    const r = bw / 2                       // pill: radius = half width

    for (let i = 0; i < BARS; i++) {
      const h = Math.max(bw, heights[i] * H * 0.84)
      const x = i * slotW + gap / 2
      const y = (H - h) / 2
      const t = (i + 0.5) / BARS * (audio.duration || 1)
      const inHovered = hoveredSeg && t >= hoveredSeg.start && t < hoveredSeg.end
      const isActive = i <= filled || inHovered

      ctx.globalAlpha = isActive ? 1.0 : 0.28
      ctx.fillStyle = colors[i] || DEFAULT_BAR_COLOR
      ctx.beginPath()
      ctx.roundRect(x, y, bw, h, r)
      ctx.fill()
    }
    ctx.globalAlpha = 1.0
  }

  const ro = new ResizeObserver(() => {
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(wrap.clientWidth * dpr)
    canvas.height = Math.round(wrap.clientHeight * dpr)
    render()
  })
  ro.observe(wrap)
  signal.addEventListener('abort', () => ro.disconnect())

  function colorAt(i) {
    if (!audio.duration) return null
    const t = (i + 0.5) / BARS * audio.duration
    const seg = segs.find(s => t >= s.start && t < s.end)
    if (!seg) return null
    const spkId = effectiveSpeaker(seg)
    return isUnrecognized(spkId, knownMap) ? null : speakerPalette(spkId).color
  }

  function updateColors() {
    for (let i = 0; i < BARS; i++) colors[i] = colorAt(i)
    render()
  }

  audio.addEventListener('loadedmetadata', () => { updateColors(); render() }, { signal })
  audio.addEventListener('timeupdate', render, { signal })

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
      render()
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
      render()
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
function makeRightPanel(transcript, knownSpeakers, transcriptId, onReload, audio = null, suggestions = {}) {
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

  // ── Speaker preview (separate Audio element, player bar unaffected) ──────────
  const previewAudio = new Audio()
  let previewStopFn = null
  let currentSetActive = null

  function stopPreview() {
    if (previewStopFn) {
      previewAudio.removeEventListener('timeupdate', previewStopFn)
      previewStopFn = null
    }
    previewAudio.pause()
    if (currentSetActive) { currentSetActive(false); currentSetActive = null }
  }

  function playPreview(seg, setActive) {
    if (!audio || !seg) return
    stopPreview()
    if (!audio.paused) audio.pause()
    currentSetActive = setActive
    setActive(true)
    if (previewAudio.src !== audio.src) previewAudio.src = audio.src
    previewAudio.currentTime = seg.start
    previewAudio.play()
    previewStopFn = () => {
      if (previewAudio.currentTime >= seg.end) {
        previewAudio.removeEventListener('timeupdate', previewStopFn)
        previewStopFn = null
        previewAudio.pause()
        if (currentSetActive) { currentSetActive(false); currentSetActive = null }
      }
    }
    previewAudio.addEventListener('timeupdate', previewStopFn)
  }

  function pausePreview() {
    if (previewStopFn) {
      previewAudio.removeEventListener('timeupdate', previewStopFn)
      previewStopFn = null
    }
    previewAudio.pause()
  }

  // Stop preview when user resumes main player (panel.isConnected guards against stale listeners after rebuild)
  if (audio) audio.addEventListener('play', () => { if (panel.isConnected) stopPreview() })

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
    btn.addEventListener('click', () => {
      if (label !== 'Speakers') {
        window.showToast?.(`${label} is not available yet`)
        return
      }
      setTab(label)
    })
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
    const durBySpeaker = {}, countBySpeaker = {}, sampleBySpeaker = {}, firstSegBySpeaker = {}
    let totalDur = 0
    transcript.segments.forEach(seg => {
      const spkId = effectiveSpeaker(seg)
      const d = seg.end - seg.start
      durBySpeaker[spkId] = (durBySpeaker[spkId] || 0) + d
      countBySpeaker[spkId] = (countBySpeaker[spkId] || 0) + 1
      totalDur += d
      if (!sampleBySpeaker[spkId]) {
        sampleBySpeaker[spkId] = seg.text
        firstSegBySpeaker[spkId] = { start: seg.start, end: seg.end }
      }
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
          totalDur, transcriptId, onReload, knownSpeakers,
          null, (setActive) => playPreview(firstSegBySpeaker[spkId], setActive), () => pausePreview()
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
          sampleBySpeaker[spkId] || null, (setActive) => playPreview(firstSegBySpeaker[spkId], setActive), () => pausePreview(),
          suggestions[spkId] || null
        )
        content.appendChild(card)
      })
    }

    if (recognized.length === 0 && unrecognized.length === 0) {
      content.appendChild(emptyState('No speakers', 'Transcript has no segments.'))
    }
  }

  function renderChapters() {}
  function renderNotes() {}
  function renderActivity() {}

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

  function buildEditor(transcript, knownSpeakers, meta = null, suggestions = {}) {
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
        fetch(`${API_BASE}/transcripts/${transcriptId}`).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }),
        fetch(`${API_BASE}/speakers`).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }),
        fetch(`${API_BASE}/transcripts/${transcriptId}/speaker-suggestions`).then(r => r.json()).catch(() => ({})),
      ])
        .then(([t, spks, suggs]) => buildEditor(t, spks, meta, suggs))
        .catch(err => window.showToast?.(`Failed to reload editor: ${err.message}`, 'error'))
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
    rightPanelEl = makeRightPanel(transcript, knownSpeakers, transcriptId, reload, audio, suggestions)
    root.appendChild(rightPanelEl)
  }

  // Initial load
  Promise.all([
    fetch(`${API_BASE}/transcripts/${transcriptId}`).then(r => {
      if (!r.ok) throw new Error(r.status)
      return r.json()
    }),
    fetch(`${API_BASE}/speakers`).then(r => r.json()),
    fetch(`${API_BASE}/transcripts/${transcriptId}/speaker-suggestions`).then(r => r.json()).catch(() => ({})),
  ])
    .then(([transcript, speakers, suggestions]) => buildEditor(transcript, speakers, meta, suggestions))
    .catch(err => {
      focusPanel.innerHTML = ''
      const errEl = document.createElement('div')
      errEl.className = 'editor-loader'
      errEl.textContent = `Failed to load: ${err.message}`
      focusPanel.appendChild(errEl)
    })

  return root
}
