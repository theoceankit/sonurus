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
  chevron.innerHTML = icon('chevron-down', 8)

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
  btnConfirm.innerHTML = icon('check', 12)

  const btnCancel = document.createElement('button')
  btnCancel.className = 'seg-edit-btn seg-edit-btn--cancel'
  btnCancel.title = 'Cancel (Esc)'
  btnCancel.innerHTML = icon('close', 10)

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

  function makeActionBtn(tooltip, iconHtml, extraClass) {
    const btn = document.createElement('button')
    btn.className = 'seg-action-btn' + (extraClass ? ' ' + extraClass : '')
    btn.setAttribute('data-tooltip', tooltip)
    btn.innerHTML = iconHtml
    attachSegTooltip(btn)
    return btn
  }

  const playBtn = makeActionBtn('Play segment', icon('play-outline', 12))

  const editBtn = makeActionBtn('Edit segment', icon('edit', 12))

  const bookmarkBtn = makeActionBtn('Save for later', icon('bookmark', 14))

  const copyBtn = makeActionBtn('Copy segment', icon('copy', 14))

  const deleteBtn = makeActionBtn('Delete segment', icon('delete', 14), 'seg-action-btn--danger')

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

  // Hiding the focused contenteditable fires `blur`, which calls commitEdit()
  // again. `editing` is cleared before the editor is hidden so that re-entry
  // is a no-op — otherwise Escape would save and Ctrl+Enter would save twice.
  function commitEdit() {
    if (!editing) return
    const newText = editArea.innerText.trim()
    if (!newText || newText === seg.text) { cancelEdit(); return }
    editing = false
    closeEditor()
    const prevText = seg.text
    seg.text = newText
    textEl.textContent = newText
    fetch(`${API_BASE}/transcripts/${transcriptId}/segments/${seg.start}/text`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newText }),
    })
      .then(r => { if (!r.ok) throw new Error(`Server error ${r.status}`) })
      .catch(err => {
        seg.text = prevText
        textEl.textContent = prevText
        window.showToast?.(`Failed to save edit: ${err.message}`, 'error')
      })
  }

  function cancelEdit() {
    editing = false
    closeEditor()
  }

  function closeEditor() {
    row.classList.remove('seg-row--editing')
    editWrap.style.display = 'none'
    textEl.style.display = ''
  }

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
