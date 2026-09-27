// ── New speaker modal ─────────────────────────────────────────────────────────
// Opened from the speaker picker's "Add new speaker". Asks for a name (required,
// prefilled with the picker search) and a color, and — when the picker was opened
// from a segment row — whether to assign just that segment or every segment of the
// current speaker. onSubmit({ name, colorIndex, scope }) must return a promise;
// scope is 'segment' or 'speaker'. The modal closes when it resolves.
function openNewSpeakerModal({ initialName = '', knownSpeakers = [], fromName = '', segmentScope = false, onSubmit }) {
  const overlay = document.createElement('div')
  overlay.className = 'nr-overlay'

  const modal = document.createElement('div')
  modal.className = 'nr-modal ns-modal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-label', 'New speaker')

  // Header
  const header = document.createElement('div')
  header.className = 'nr-modal-header'
  const title = document.createElement('div')
  title.className = 'nr-modal-title ns-title'
  title.textContent = 'New speaker'
  const closeBtn = document.createElement('button')
  closeBtn.className = 'nr-modal-close'
  closeBtn.setAttribute('aria-label', 'Close')
  closeBtn.innerHTML = icon('close', 8)
  header.append(title, closeBtn)

  const body = document.createElement('div')
  body.className = 'nr-modal-body'

  // Name: avatar preview + input
  let colorIndex = leastUsedColorIndex(knownSpeakers)

  const nameField = document.createElement('div')
  nameField.className = 'nr-field'
  const nameLabel = document.createElement('label')
  nameLabel.className = 'nr-field-label'
  nameLabel.textContent = 'Name'
  nameLabel.htmlFor = 'ns-name'

  const nameRow = document.createElement('div')
  nameRow.className = 'ns-name-row'
  const av = document.createElement('div')
  av.className = 'ns-av'
  const input = document.createElement('input')
  input.id = 'ns-name'
  input.className = 'st-text-input ns-name-input'
  input.placeholder = 'Speaker name'
  input.maxLength = 128
  input.value = initialName.trim()
  nameRow.append(av, input)

  // Same names are allowed (identity is the id); just make it visible.
  const hint = document.createElement('div')
  hint.className = 'spk-name-hint'
  const error = document.createElement('div')
  error.className = 'spk-name-error'
  nameField.append(nameLabel, nameRow, hint, error)

  // Color
  const colorField = document.createElement('div')
  colorField.className = 'nr-field'
  const colorLabel = document.createElement('div')
  colorLabel.className = 'nr-field-label'
  colorLabel.textContent = 'Color'
  const swatches = document.createElement('div')
  swatches.className = 'spk-swatches'
  const swatchBtns = SPEAKER_PALETTE.map((p, idx) => {
    const sw = document.createElement('button')
    sw.type = 'button'
    sw.className = 'spk-swatch ns-swatch'
    sw.style.background = p.color
    sw.setAttribute('aria-label', `Color ${idx + 1}`)
    sw.addEventListener('click', () => { colorIndex = idx; refresh(); input.focus() })
    swatches.appendChild(sw)
    return sw
  })
  colorField.append(colorLabel, swatches)

  // Scope: a toggle from a segment row, a note otherwise
  let scope = segmentScope ? 'segment' : 'speaker'
  const from = fromName ? `“${fromName}”` : 'this speaker'
  const scopeField = document.createElement('div')
  scopeField.className = 'nr-field'
  const scopeLabel = document.createElement('div')
  scopeLabel.className = 'nr-field-label'
  scopeLabel.textContent = 'Assign to'
  scopeField.appendChild(scopeLabel)
  const scopeBtns = []
  if (segmentScope) {
    const seg = document.createElement('div')
    seg.className = 'ns-scope'
    ;[['segment', 'This segment'], ['speaker', `All segments of ${from}`]].forEach(([value, label]) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'ns-scope-btn'
      b.dataset.scope = value
      b.textContent = label
      b.addEventListener('click', () => { scope = value; refresh(); input.focus() })
      seg.appendChild(b)
      scopeBtns.push(b)
    })
    scopeField.appendChild(seg)
  } else {
    const note = document.createElement('div')
    note.className = 'ns-scope-note'
    note.textContent = `All segments of ${from} in this transcript`
    scopeField.appendChild(note)
  }

  body.append(nameField, colorField, scopeField)

  // Footer
  const footer = document.createElement('div')
  footer.className = 'confirm-btns ns-footer'
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'st-btn st-btn--ghost'
  cancelBtn.textContent = 'Cancel'
  const addBtn = document.createElement('button')
  addBtn.className = 'st-btn st-btn--primary'
  addBtn.textContent = 'Add speaker'
  footer.append(cancelBtn, addBtn)

  modal.append(header, body, footer)
  overlay.appendChild(modal)

  let busy = false
  function refresh() {
    const name = input.value.trim()
    av.style.background = SPEAKER_PALETTE[colorIndex].color
    av.textContent = name ? speakerInitials(name) : ''
    swatchBtns.forEach((sw, i) => sw.classList.toggle('spk-swatch--active', i === colorIndex))
    scopeBtns.forEach(b => b.classList.toggle('ns-scope-btn--active', b.dataset.scope === scope))
    hint.textContent = hasSpeakerNamed(knownSpeakers, name) ? `Another speaker is also named “${name}”.` : ''
    addBtn.disabled = !name || busy
  }

  async function submit() {
    const name = input.value.trim()
    if (!name || busy) return
    busy = true
    error.textContent = ''
    refresh()
    try {
      await onSubmit({ name, colorIndex, scope })
      close()
    } catch (err) {
      busy = false
      error.textContent = err.message
      refresh()
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close() }
  }
  function close() {
    document.removeEventListener('keydown', onKey)
    overlay.remove()
  }
  document.addEventListener('keydown', onKey)
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close() })
  closeBtn.addEventListener('click', close)
  cancelBtn.addEventListener('click', close)
  addBtn.addEventListener('click', submit)
  input.addEventListener('input', () => { error.textContent = ''; refresh() })
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit() } })

  refresh()
  document.body.appendChild(overlay)
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
  return overlay
}
