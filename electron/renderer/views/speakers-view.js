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

// ── Voice sample player ────────────────────────────────────────────────────────
const _SAMPLE_PLAY  = icon('play', 14)
const _SAMPLE_PAUSE = icon('pause', 14)
const SAMPLE_MAX_SEC = 15  // a very long segment is cut to a short preview

function _sampleUrl(speakerId, transcriptId = null) {
  const q = transcriptId == null ? '' : `?transcript_id=${transcriptId}`
  return `${API_BASE}/speakers/${encodeURIComponent(speakerId)}/sample${q}`
}

// One Audio element per speaker page; one sample plays at a time.
function makeSamplePlayer() {
  const audio = new Audio()
  let stopAt = 0
  let activeBtn = null

  function setIcon(btn, playing) {
    btn.innerHTML = playing ? _SAMPLE_PAUSE : _SAMPLE_PLAY
    btn.classList.toggle('spk-play-btn--playing', playing)
  }
  function stop() {
    audio.pause()
    if (activeBtn) setIcon(activeBtn, false)
    activeBtn = null
  }
  audio.addEventListener('timeupdate', () => { if (audio.currentTime >= stopAt) stop() })
  audio.addEventListener('ended', stop)

  return {
    // Toggle: a second click on the playing button stops it.
    toggle(btn, sample) {
      if (activeBtn === btn) { stop(); return }
      stop()
      const src = fileUrl(sample.audio_path)
      if (audio.src !== src) audio.src = src
      audio.currentTime = sample.start
      stopAt = Math.min(sample.end, sample.start + SAMPLE_MAX_SEC)
      activeBtn = btn
      setIcon(btn, true)
      audio.play().catch(err => {
        stop()
        window.showToast?.(`Could not play audio: ${err.message}`, 'error')
      })
    },
    dispose() { stop(); audio.removeAttribute('src'); audio.load() },
  }
}

function makeSamplePlayButton(label) {
  const btn = document.createElement('button')
  btn.className = 'spk-play-btn'
  btn.innerHTML = _SAMPLE_PLAY
  btn.setAttribute('aria-label', label)
  btn.title = label
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
  const player = makeSamplePlayer()
  root._cleanup = () => player.dispose()  // called by app._setView on navigation

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

  // ── Voice sample: the most characteristic segment ─────────────────────────
  const sampleBox = document.createElement('div')
  sampleBox.className = 'spk-sample'
  const sampleText = document.createElement('span')
  sampleText.className = 'spk-sample-text'
  sampleText.textContent = 'Loading voice sample…'
  sampleBox.appendChild(sampleText)
  header.appendChild(sampleBox)

  fetch(_sampleUrl(row.id))
    .then(r => r.ok ? r.json() : null)
    .catch(() => null)
    .then(sample => {
      if (!sample) {
        sampleBox.classList.add('spk-sample--none')
        sampleText.textContent = 'Audio unavailable — the recordings of this speaker were moved or deleted.'
        return
      }
      const btn = makeSamplePlayButton('Play voice sample')
      btn.addEventListener('click', () => player.toggle(btn, sample))
      const q = sample.text.length > 120 ? sample.text.slice(0, 120) + '…' : sample.text
      sampleText.textContent = `“${q}”`
      sampleBox.prepend(btn)
    })

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
        const rowEl = document.createElement('div')
        rowEl.className = 'spk-tr-row'

        // The sample for this transcript is fetched on first click.
        const playBtn = makeSamplePlayButton('Play a sample from this transcript')
        let sample = null
        playBtn.addEventListener('click', async () => {
          if (!sample) {
            playBtn.disabled = true
            const r = await fetch(_sampleUrl(row.id, t.id)).catch(() => null)
            playBtn.disabled = false
            if (!r?.ok) {
              playBtn.disabled = true
              playBtn.title = 'Audio unavailable'
              window.showToast?.('The audio of this transcript is unavailable.')
              return
            }
            sample = await r.json()
          }
          player.toggle(playBtn, sample)
        })

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
        rowEl.append(playBtn, item)
        trList.appendChild(rowEl)
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
