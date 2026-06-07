// ── Segment row ────────────────────────────────────────────────────────────────
function makeSegmentRow(seg, transcriptId, displayName, onReload, knownMap = {}, knownSpeakers = [], audio = null) {
  const spkId = effectiveSpeaker(seg)
  const p = isUnrecognized(spkId, knownMap) ? null : speakerPalette(spkId, knownMap)
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

  editArea.addEventListener('blur', () => commitEdit())

  return row
}
