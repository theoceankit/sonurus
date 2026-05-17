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
function makeSegmentRow(seg, transcriptId, displayName, onReload, knownMap = {}, knownSpeakers = []) {
  const spkId = effectiveSpeaker(seg)
  const p = isUnrecognized(spkId, knownMap) ? null : speakerPalette(spkId)
  let editing = false

  const row = document.createElement('div')
  row.className = 'seg-row'
  row.dataset.start = seg.start

  // Left: timestamp
  const time = document.createElement('button')
  time.className = 'seg-time'
  time.textContent = fmtTime(seg.start)
  time.title = `${fmtTime(seg.start)} – ${fmtTime(seg.end)}`

  // Middle: speaker header + text
  const mid = document.createElement('div')
  mid.className = 'seg-mid'

  const header = document.createElement('div')
  header.className = 'seg-header'

  const avatar = makeAvatar(spkId, displayName, 20)
  const nameBtn = document.createElement('button')
  nameBtn.className = 'seg-speaker-name'
  nameBtn.textContent = displayName
  if (p) nameBtn.style.color = p.color
  nameBtn.addEventListener('click', e => {
    e.stopPropagation()
    showSpeakerPicker(nameBtn, spkId, knownSpeakers, transcriptId, onReload, seg.start)
  })

  // ── Action buttons (appear on hover) ────────────────────────────────────
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

  const SVG_PLAY = `<svg width="9" height="11" viewBox="0 0 9 11" fill="none">
    <path d="M1.5 1.2L7.5 5.5 1.5 9.8V1.2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  </svg>`
  const SVG_EDIT = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2 8.5L8 2.5 9.5 4 3.5 10H2V8.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M7 3.5L8.5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`
  const SVG_BOOKMARK = `<svg width="10" height="12" viewBox="0 0 11 13" fill="none">
    <path d="M1.5 1.5h8v10l-4-2.5-4 2.5v-10z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  </svg>`
  const SVG_COPY = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
    <path d="M7.5 4V2A1.5 1.5 0 006 .5H2A1.5 1.5 0 00.5 2v4A1.5 1.5 0 002 7.5h2" stroke="currentColor" stroke-width="1.2"/>
  </svg>`
  const SVG_DELETE = `<svg width="11" height="12" viewBox="0 0 11 12" fill="none">
    <rect x="1" y="3" width="9" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
    <path d="M3.5 3V2a1 1 0 011-1h2a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.2"/>
    <line x1="0.5" y1="3" x2="10.5" y2="3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    <line x1="4" y1="5.5" x2="4" y2="9.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
    <line x1="7" y1="5.5" x2="7" y2="9.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
  </svg>`

  const playBtn     = makeActionBtn('Play segment',   SVG_PLAY,     '')
  const editBtn     = makeActionBtn('Edit segment',   SVG_EDIT,     '')
  const bookmarkBtn = makeActionBtn('Save for later', SVG_BOOKMARK, '')
  const copyBtn     = makeActionBtn('Copy segment',   SVG_COPY,     '')
  const deleteBtn   = makeActionBtn('Delete segment', SVG_DELETE,   'seg-action-btn--danger')

  actions.appendChild(playBtn)
  actions.appendChild(editBtn)
  actions.appendChild(bookmarkBtn)
  actions.appendChild(copyBtn)
  actions.appendChild(deleteBtn)

  header.appendChild(avatar)
  header.appendChild(nameBtn)
  header.appendChild(actions)

  // Text area
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

  const editActions = document.createElement('div')
  editActions.className = 'seg-edit-actions'

  const editHint = document.createElement('span')
  editHint.className = 'seg-edit-hint'
  editHint.innerHTML = '<kbd class="seg-key">Shift</kbd> + <kbd class="seg-key">↵</kbd> new line'

  const cancelEditBtn = document.createElement('button')
  cancelEditBtn.className = 'seg-edit-btn seg-edit-btn--cancel'
  cancelEditBtn.textContent = 'Cancel'

  const saveEditBtn = document.createElement('button')
  saveEditBtn.className = 'seg-edit-btn seg-edit-btn--save'
  saveEditBtn.textContent = 'Save'

  editActions.appendChild(editHint)
  editActions.appendChild(cancelEditBtn)
  editActions.appendChild(saveEditBtn)

  editWrap.appendChild(editArea)
  editWrap.appendChild(editActions)

  mid.appendChild(header)
  mid.appendChild(textEl)
  mid.appendChild(editWrap)

  row.appendChild(time)
  row.appendChild(mid)

  // ── Interactions ──────────────────────────────────────────────────────────

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
    if (!newText || newText === seg.text) {
      cancelEdit()
      return
    }
    fetch(`${API_BASE}/transcripts/${transcriptId}/segments/${seg.start}/text`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newText }),
    }).then(() => {
      seg.text = newText
      textEl.textContent = newText
      cancelEdit()
    }).catch(() => cancelEdit())
  }

  function cancelEdit() {
    editing = false
    row.classList.remove('seg-row--editing')
    editWrap.style.display = 'none'
    textEl.style.display = ''
  }

  // Enter edit on text click or edit button
  textEl.addEventListener('click', enterEditMode)
  editBtn.addEventListener('click', enterEditMode)

  editArea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit() }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
  })

  cancelEditBtn.addEventListener('click', cancelEdit)
  saveEditBtn.addEventListener('click', commitEdit)

  // Copy to clipboard
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(seg.text).then(() => {
      copyBtn.setAttribute('data-tooltip', 'Copied!')
      setTimeout(() => copyBtn.setAttribute('data-tooltip', 'Copy segment'), 1500)
    })
  })

  // Delete segment
  deleteBtn.addEventListener('click', () => {
    fetch(`${API_BASE}/transcripts/${transcriptId}/segments/${seg.start}`, {
      method: 'DELETE',
    }).then(r => {
      if (!r.ok) throw new Error(r.status)
      row.style.transition = 'opacity 0.15s'
      row.style.opacity = '0'
      setTimeout(() => { row.remove(); onReload() }, 150)
    })
  })

  // Play (no-op until audio is implemented)
  playBtn.addEventListener('click', () => {
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
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

// ── Player bar ─────────────────────────────────────────────────────────────────
function makePlayerBar(transcript, audio, signal) {
  const segs = transcript.segments

  const bar = document.createElement('div')
  bar.className = 'player-bar'

  const sideL = document.createElement('div')
  sideL.className = 'player-side'

  const center = document.createElement('div')
  center.className = 'player-center'

  const sideR = document.createElement('div')
  sideR.className = 'player-side player-side--right'

  // ── Icons ──────────────────────────────────────────────────────────────────
  const I_PREV_SPK = `<svg width="20" height="20" viewBox="0 0 24 24"><g transform="scale(-1,1) translate(-24,0)"><path fill="currentColor" fill-rule="evenodd" d="M13.97 6.47a.75.75 0 0 1 1.06 0l5 5a.75.75 0 0 1 0 1.06l-5 5a.75.75 0 1 1-1.06-1.06l3.72-3.72H9.5c-.713 0-1.8.22-2.687.859-.848.61-1.563 1.635-1.563 3.391a.75.75 0 0 1-1.5 0c0-2.244.952-3.72 2.187-4.609 1.196-.861 2.61-1.141 3.563-1.141h8.19l-3.72-3.72a.75.75 0 0 1 0-1.06" clip-rule="evenodd"/></g></svg>`
  const I_PREV_SEG = `<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="m19.95 16.975-6.2-4.15q-.225-.15-.337-.362T13.3 12t.113-.462.337-.363l6.2-4.15q.125-.1.275-.125t.275-.025q.4 0 .7.275t.3.725v8.25q0 .45-.3.725t-.7.275q-.125 0-.275-.025t-.275-.125m-10 0-6.2-4.15q-.225-.15-.337-.362T3.3 12t.113-.462.337-.363l6.2-4.15q.125-.1.275-.125t.275-.025q.4 0 .7.275t.3.725v8.25q0 .45-.3.725t-.7.275q-.125 0-.275-.025t-.275-.125"/></svg>`
  const I_PLAY    = `<svg width="26" height="26" viewBox="0 0 24 24"><path fill="currentColor" d="M9 15.714V8.287q0-.368.244-.588.243-.22.568-.22.102 0 .213.028.11.027.211.083l5.843 3.733q.186.13.28.298.093.167.093.379t-.093.379-.28.298l-5.843 3.733q-.101.055-.213.083t-.213.028q-.326 0-.568-.22T9 15.714"/></svg>`
  const I_PAUSE   = `<svg width="26" height="26" viewBox="0 0 24 24"><path fill="currentColor" d="M16 19q-.825 0-1.412-.587T14 17V7q0-.825.588-1.412T16 5t1.413.588T18 7v10q0 .825-.587 1.413T16 19m-8 0q-.825 0-1.412-.587T6 17V7q0-.825.588-1.412T8 5t1.413.588T10 7v10q0 .825-.587 1.413T8 19"/></svg>`
  const I_NEXT_SEG = `<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M2.5 16.125v-8.25q0-.45.3-.725t.7-.275q.125 0 .275.025t.275.125l6.2 4.15q.225.15.338.363T10.7 12t-.112.463-.338.362l-6.2 4.15q-.125.1-.275.125t-.275.025q-.4 0-.7-.275t-.3-.725m10 0v-8.25q0-.45.3-.725t.7-.275q.125 0 .275.025t.275.125l6.2 4.15q.225.15.338.363T20.7 12t-.112.463-.338.362l-6.2 4.15q-.125.1-.275.125t-.275.025q-.4 0-.7-.275t-.3-.725"/></svg>`
  const I_NEXT_SPK = `<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M13.97 6.47a.75.75 0 0 1 1.06 0l5 5a.75.75 0 0 1 0 1.06l-5 5a.75.75 0 1 1-1.06-1.06l3.72-3.72H9.5c-.713 0-1.8.22-2.687.859-.848.61-1.563 1.635-1.563 3.391a.75.75 0 0 1-1.5 0c0-2.244.952-3.72 2.187-4.609 1.196-.861 2.61-1.141 3.563-1.141h8.19l-3.72-3.72a.75.75 0 0 1 0-1.06" clip-rule="evenodd"/></svg>`
  const I_VOLUME  = `<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M14 20.725v-2.05q2.25-.65 3.625-2.5t1.375-4.2-1.375-4.2T14 5.275v-2.05q3.1.7 5.05 3.138T21 11.975t-1.95 5.613T14 20.725M3 15V9h4l5-5v16l-5-5zm11 1V7.95q1.175.55 1.838 1.65T16.5 12q0 1.275-.663 2.363T14 16"/></svg>`

  function makeBtn(tooltip, html, cls = '') {
    const btn = document.createElement('button')
    btn.className = 'player-btn' + (cls ? ' ' + cls : '')
    btn.setAttribute('data-tooltip', tooltip)
    btn.innerHTML = html
    attachSegTooltip(btn)
    return btn
  }

  const prevSpkBtn = makeBtn('Previous speaker', I_PREV_SPK)
  const prevSegBtn = makeBtn('Previous segment', I_PREV_SEG)
  const playBtn    = makeBtn('Play / Pause',     I_PLAY, 'player-btn--play')
  const nextSegBtn = makeBtn('Next segment',     I_NEXT_SEG)
  const nextSpkBtn = makeBtn('Next speaker',     I_NEXT_SPK)

  const controls = document.createElement('div')
  controls.className = 'player-controls'
  ;[prevSpkBtn, prevSegBtn, playBtn, nextSegBtn, nextSpkBtn].forEach(b => controls.appendChild(b))

  // ── Progress ────────────────────────────────────────────────────────────────
  const elapsed = document.createElement('span')
  elapsed.className = 'player-time'
  elapsed.textContent = '00:00'

  const track = document.createElement('input')
  track.type = 'range'
  track.className = 'player-track'
  track.min = 0; track.max = 1000; track.value = 0

  const total = document.createElement('span')
  total.className = 'player-time'
  total.textContent = '00:00'

  const progress = document.createElement('div')
  progress.className = 'player-progress'
  ;[elapsed, track, total].forEach(el => progress.appendChild(el))

  center.appendChild(controls)
  center.appendChild(progress)

  // ── Volume ──────────────────────────────────────────────────────────────────
  const volBtn = document.createElement('button')
  volBtn.className = 'player-btn'
  volBtn.innerHTML = I_VOLUME

  const volSlider = document.createElement('input')
  volSlider.type = 'range'
  volSlider.className = 'player-vol'
  volSlider.min = 0; volSlider.max = 100; volSlider.value = 80
  audio.volume = 0.8

  sideR.appendChild(volBtn)
  sideR.appendChild(volSlider)

  bar.appendChild(sideL)
  bar.appendChild(center)
  bar.appendChild(sideR)

  // ── Audio event wiring ─────────────────────────────────────────────────────
  let seeking = false

  function updateTrack() {
    if (!seeking && audio.duration) {
      const pct = audio.currentTime / audio.duration
      track.value = pct * 1000
      track.style.setProperty('--pct', (pct * 100).toFixed(2) + '%')
      elapsed.textContent = fmtTime(audio.currentTime)
    }
  }

  audio.addEventListener('timeupdate',     updateTrack, { signal })
  audio.addEventListener('durationchange', () => {
    if (isFinite(audio.duration)) total.textContent = fmtTime(audio.duration)
  }, { signal })
  audio.addEventListener('play',  () => { playBtn.innerHTML = I_PAUSE }, { signal })
  audio.addEventListener('pause', () => { playBtn.innerHTML = I_PLAY  }, { signal })
  audio.addEventListener('ended', () => { playBtn.innerHTML = I_PLAY  }, { signal })

  playBtn.addEventListener('click', () => {
    audio.paused ? audio.play().catch(() => {}) : audio.pause()
  })

  track.addEventListener('mousedown', () => { seeking = true })
  track.addEventListener('input', () => {
    if (audio.duration) {
      const t = (track.value / 1000) * audio.duration
      elapsed.textContent = fmtTime(t)
      track.style.setProperty('--pct', (track.value / 10).toFixed(2) + '%')
    }
  })
  track.addEventListener('change', () => {
    if (audio.duration) audio.currentTime = (track.value / 1000) * audio.duration
    seeking = false
  })

  volSlider.addEventListener('input', () => { audio.volume = volSlider.value / 100 })

  // ── Segment / speaker navigation ────────────────────────────────────────────
  function curSegIdx() {
    const t = audio.currentTime
    for (let i = segs.length - 1; i >= 0; i--) {
      if (segs[i].start <= t) return i
    }
    return 0
  }

  prevSegBtn.addEventListener('click', () => {
    const i = curSegIdx()
    audio.currentTime = i > 0 ? segs[i - 1].start : 0
  })
  nextSegBtn.addEventListener('click', () => {
    const i = curSegIdx()
    if (i + 1 < segs.length) audio.currentTime = segs[i + 1].start
  })

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

  // Tabs
  const tabBar = document.createElement('div')
  tabBar.className = 'right-tabs'

  const tabs = ['Speakers', 'Notes', 'Marks']
  let activeTab = 'Speakers'

  const content = document.createElement('div')
  content.className = 'right-content quiet-scroll'

  function renderContent() {
    content.innerHTML = ''
    if (activeTab === 'Speakers') renderSpeakers()
    else {
      const empty = document.createElement('div')
      empty.className = 'right-empty'
      empty.innerHTML = `<div class="right-empty-title">No ${activeTab.toLowerCase()} yet</div>`
      content.appendChild(empty)
    }
  }

  function renderSpeakers() {
    // Aggregate speaker durations from segments
    const durBySpeaker = {}
    const countBySpeaker = {}
    const sampleBySpeaker = {}
    let totalDur = 0

    transcript.segments.forEach(seg => {
      const spkId = effectiveSpeaker(seg)
      const d = seg.end - seg.start
      durBySpeaker[spkId] = (durBySpeaker[spkId] || 0) + d
      countBySpeaker[spkId] = (countBySpeaker[spkId] || 0) + 1
      totalDur += d
      if (!sampleBySpeaker[spkId]) sampleBySpeaker[spkId] = seg.text
    })

    const knownMap = {}
    knownSpeakers.forEach(s => { knownMap[s.id] = s.name })

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
      content.appendChild(sectionLabel('Recognized', recognized.length, '#2EB387'))
      recognized.forEach(spkId => {
        const displayName = knownMap[spkId] || spkId
        const card = makeSpeakerCard(
          spkId, displayName,
          countBySpeaker[spkId], durBySpeaker[spkId],
          totalDur, transcriptId, onReload, knownSpeakers
        )
        content.appendChild(card)
      })
    }

    if (unrecognized.length > 0) {
      let n = 0
      content.appendChild(sectionLabel('Unrecognized', unrecognized.length, '#B58A3A'))
      unrecognized.forEach(spkId => {
        n++
        const displayName = `Unknown speaker ${n}`
        const card = makeSpeakerCard(
          spkId, displayName,
          countBySpeaker[spkId], durBySpeaker[spkId],
          totalDur, transcriptId, onReload, knownSpeakers
        )
        // Add sample quote
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
  }

  tabs.forEach(label => {
    const btn = document.createElement('button')
    btn.className = 'right-tab-btn' + (label === activeTab ? ' right-tab-btn--active' : '')
    btn.textContent = label
    btn.addEventListener('click', () => {
      activeTab = label
      tabBar.querySelectorAll('.right-tab-btn').forEach(b => {
        b.classList.toggle('right-tab-btn--active', b.textContent === label)
      })
      renderContent()
    })
    tabBar.appendChild(btn)
  })

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
      // Assign stable "Unknown N" label for unrecognized speakers
      const unrecognizedIds = [...new Set(
        transcript.segments
          .map(s => effectiveSpeaker(s))
          .filter(id => isUnrecognized(id, knownMap))
      )]
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

    // ── Segment list ──────────────────────────────────────────────────────────
    const segList = document.createElement('div')
    segList.className = 'seg-list quiet-scroll'

    transcript.segments.forEach(seg => {
      const spkId = effectiveSpeaker(seg)
      const row = makeSegmentRow(seg, transcriptId, displayName(spkId), reload, knownMap, knownSpeakers)
      // Color the speaker name in row
      const nameBtn = row.querySelector('.seg-speaker-name')
      if (nameBtn && !isUnrecognized(spkId, knownMap)) {
        nameBtn.style.color = speakerPalette(spkId).color
      }
      segList.appendChild(row)
    })

    focusPanel.appendChild(topBar)
    focusPanel.appendChild(segList)
    focusPanel.appendChild(makePlayerBar(transcript, audio, playerAbortCtrl.signal))

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
