// ── Speakers section ───────────────────────────────────────────────────────────
// Sidebar list items and the speaker detail page (main panel). State and API
// calls that change data live in app.js; this file only renders.

function _speakerAvatar(row, size) {
  return makeAvatar(row.id, row.name || '?', size, buildKnownMap([row]))
}

function makeSpeakerListItem(row, { active = false, duplicate = false, onClick }) {
  const btn = document.createElement('button')
  btn.className = 'spk-item' + (active ? ' spk-item--active' : '') + (row.name ? '' : ' spk-item--unnamed')
  btn.dataset.speakerId = row.id

  const info = document.createElement('div')
  info.className = 'spk-item-info'

  const nameRow = document.createElement('div')
  nameRow.className = 'spk-item-name-row'
  const name = document.createElement('span')
  name.className = 'spk-item-name'
  name.textContent = speakerDisplayName(row)
  nameRow.appendChild(name)
  if (duplicate) {
    const badge = document.createElement('span')
    badge.className = 'spk-dup-badge'
    badge.textContent = 'same name'
    badge.title = 'Another speaker has the same name — they are different people'
    nameRow.appendChild(badge)
  }

  const meta = document.createElement('div')
  meta.className = 'spk-item-meta'
  meta.textContent = speakerStatsLine(row)

  info.append(nameRow, meta)
  btn.append(_speakerAvatar(row, 28), info)
  btn.addEventListener('click', onClick)
  return btn
}

function renderSpeakersPlaceholder(text) {
  const el = document.createElement('div')
  el.className = 'spk-page-empty'
  el.textContent = text
  return el
}

function _fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d)) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ctx: { duplicate, deleteBlockReason, onSave(patch) → Promise, onDelete(),
//        onOpenTranscript(id) }. onSave rejects with an Error whose message is shown.
function renderSpeakerDetail(row, ctx) {
  const root = document.createElement('div')
  root.className = 'spk-page quiet-scroll'

  const content = document.createElement('div')
  content.className = 'spk-page-content'
  root.appendChild(content)

  // ── Header: avatar + editable name ────────────────────────────────────────
  const header = document.createElement('div')
  header.className = 'st-card spk-page-header'

  const top = document.createElement('div')
  top.className = 'spk-page-top'
  top.appendChild(_speakerAvatar(row, 52))

  const titleBox = document.createElement('div')
  titleBox.className = 'spk-page-title-box'

  const form = document.createElement('form')
  form.className = 'spk-name-form'
  const input = document.createElement('input')
  input.className = 'spk-name-input'
  input.value = row.name || ''
  input.placeholder = 'Add a name'
  input.maxLength = 128
  input.setAttribute('aria-label', 'Speaker name')
  const saveBtn = document.createElement('button')
  saveBtn.type = 'submit'
  saveBtn.className = 'st-btn st-btn--primary st-btn--sm'
  saveBtn.textContent = 'Save'
  saveBtn.hidden = true
  form.append(input, saveBtn)

  const error = document.createElement('div')
  error.className = 'spk-name-error'

  // Same names are allowed (identity is the id); just make it visible.
  const sameName = document.createElement('div')
  sameName.className = 'spk-name-hint'
  if (ctx.duplicate) sameName.textContent = `Another speaker is also named “${row.name}”.`

  const sub = document.createElement('div')
  sub.className = 'spk-page-sub'
  sub.textContent = row.name
    ? 'Recognized speaker'
    : 'Unnamed speaker — add a name to recognize them in transcripts'

  titleBox.append(form, error, sameName, sub)
  top.appendChild(titleBox)
  header.appendChild(top)

  const dirty = () => input.value.trim() !== (row.name || '') && input.value.trim() !== ''
  input.addEventListener('input', () => { saveBtn.hidden = !dirty(); error.textContent = '' })
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { input.value = row.name || ''; saveBtn.hidden = true; error.textContent = ''; input.blur() }
  })
  form.addEventListener('submit', async e => {
    e.preventDefault()
    if (!dirty()) return
    saveBtn.disabled = true
    try {
      await ctx.onSave({ name: input.value.trim() })
    } catch (err) {
      error.textContent = err.message
      saveBtn.disabled = false
    }
  })

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = document.createElement('div')
  stats.className = 'spk-stats'
  ;[
    ['Transcripts', String(row.transcripts || 0)],
    ['Segments', String(row.segments || 0)],
    ['Speaking time', fmtTime(row.duration_sec || 0)],
    ['Last seen', _fmtDate(row.last_seen)],
  ].forEach(([label, value]) => {
    const cell = document.createElement('div')
    cell.className = 'spk-stat'
    const v = document.createElement('div')
    v.className = 'spk-stat-value'
    v.textContent = value
    const l = document.createElement('div')
    l.className = 'spk-stat-label'
    l.textContent = label
    cell.append(v, l)
    stats.appendChild(cell)
  })
  header.appendChild(stats)
  content.appendChild(header)

  // ── Color ─────────────────────────────────────────────────────────────────
  const colorCard = document.createElement('div')
  colorCard.className = 'st-card spk-page-card'
  const colorTitle = document.createElement('div')
  colorTitle.className = 'spk-card-title'
  colorTitle.textContent = 'Color'
  colorCard.appendChild(colorTitle)
  if (row.name) {
    const swatches = document.createElement('div')
    swatches.className = 'spk-swatches'
    SPEAKER_PALETTE.forEach((p, idx) => {
      const sw = document.createElement('button')
      sw.className = 'spk-swatch' + (idx === row.color_index ? ' spk-swatch--active' : '')
      sw.style.background = p.color
      sw.setAttribute('aria-label', `Color ${idx + 1}`)
      sw.addEventListener('click', () => {
        if (idx === row.color_index) return
        ctx.onSave({ color_index: idx }).catch(err => window.showToast?.(err.message, 'error'))
      })
      swatches.appendChild(sw)
    })
    colorCard.appendChild(swatches)
  } else {
    const hint = document.createElement('div')
    hint.className = 'spk-card-hint'
    hint.textContent = 'Unnamed speakers are shown in grey. Add a name to choose a color.'
    colorCard.appendChild(hint)
  }
  content.appendChild(colorCard)

  // ── Transcripts ───────────────────────────────────────────────────────────
  const trCard = document.createElement('div')
  trCard.className = 'st-card spk-page-card'
  const trTitle = document.createElement('div')
  trTitle.className = 'spk-card-title'
  trTitle.textContent = 'Appears in'
  const trList = document.createElement('div')
  trList.className = 'spk-tr-list'
  trList.appendChild(renderSpeakersPlaceholder('Loading…'))
  trCard.append(trTitle, trList)
  content.appendChild(trCard)

  fetch(`${API_BASE}/speakers/${encodeURIComponent(row.id)}/transcripts`)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
    .then(items => {
      trList.replaceChildren()
      if (items.length === 0) {
        trList.appendChild(renderSpeakersPlaceholder('Not in any transcript yet.'))
        return
      }
      items.forEach(t => {
        const item = document.createElement('button')
        item.className = 'spk-tr-item'
        const title = document.createElement('span')
        title.className = 'spk-tr-title'
        title.textContent = t.title
        const meta = document.createElement('span')
        meta.className = 'spk-tr-meta'
        meta.textContent = `${_fmtDate(t.created_at)} · ${t.segments} seg. · ${fmtTime(t.duration_sec)}`
        item.append(title, meta)
        item.addEventListener('click', () => ctx.onOpenTranscript(t.id))
        trList.appendChild(item)
      })
    })
    .catch(err => {
      trList.replaceChildren(renderSpeakersPlaceholder(`Could not load transcripts: ${err.message}`))
    })

  // ── Delete ────────────────────────────────────────────────────────────────
  const delCard = document.createElement('div')
  delCard.className = 'st-card spk-page-card spk-page-danger'
  const delText = document.createElement('div')
  delText.className = 'spk-card-hint'
  delText.textContent = 'Deleting a speaker removes the name, color and voice profile. '
    + 'Their segments stay in the transcripts as Unassigned.'
  const delBtn = document.createElement('button')
  delBtn.className = 'st-btn st-btn--danger'
  delBtn.textContent = 'Delete speaker…'
  if (ctx.deleteBlockReason) {
    delBtn.disabled = true
    delBtn.title = ctx.deleteBlockReason
  }
  delBtn.addEventListener('click', () => ctx.onDelete())
  delCard.append(delText, delBtn)
  content.appendChild(delCard)

  return root
}
