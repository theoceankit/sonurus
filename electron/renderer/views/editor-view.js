// ── Editor view entry point ────────────────────────────────────────────────────
// Components are loaded as separate scripts (see index.html):
//   editor/tooltip.js, editor/speaker-picker.js, editor/segment-row.js,
//   editor/speaker-card.js, editor/waveform.js, editor/player-bar.js,
//   editor/right-panel.js

// ── Speaker index helper ────────────────────────────────────────────────────────
// Builds the "Unknown N" display-name index once per buildEditor call so
// displayName() does not have to iterate all segments on every row (O(N²)).
function buildSpeakerIndex(segments, knownMap) {
  const firstSeen = {}
  segments.forEach(s => {
    const id = effectiveSpeaker(s)
    if (isUnrecognized(id, knownMap) && !(id in firstSeen)) firstSeen[id] = s.start
  })
  const unrecIds = Object.keys(firstSeen).sort((a, b) => firstSeen[a] - firstSeen[b])
  return { firstSeen, unrecIds }
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
    const isLiveRec = audioPath.includes('sonorus-rec-')
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
    knownSpeakers.forEach(s => { knownMap[s.id] = { name: s.name, colorIndex: s.color_index ?? 0 } })

    const { unrecIds: _unrecIds } = buildSpeakerIndex(transcript.segments, knownMap)
    function displayName(spkId) {
      if (knownMap[spkId]) return knownMap[spkId].name
      const n = _unrecIds.indexOf(spkId) + 1
      return n > 0 ? `Unknown ${n}` : spkId
    }

    function reload() {
      Promise.all([
        fetch(`${API_BASE}/transcripts/${transcriptId}`).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }),
        fetch(`${API_BASE}/speakers`).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }),
        fetch(`${API_BASE}/transcripts/${transcriptId}/speaker-suggestions`).then(r => r.json()).catch(() => ({})),
      ])
        .then(([t, spks, suggs]) => { buildEditor(t, spks, meta, suggs); app._loadSidebar() })
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

    const titleText = transcript.title
      || meta?.title
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
          const p = speakerPalette(spkId, knownMap)
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

    // Wire playing indicator — binary-search index for O(log N) timeupdate
    const segRowIndex = Array.from(segList.querySelectorAll('.seg-row')).map(r => ({
      start: parseFloat(r.dataset.start),
      end:   parseFloat(r.dataset.end || '9999'),
      el:    r,
    }))
    let _activeIdx = -1
    audio.addEventListener('timeupdate', () => {
      const t = audio.currentTime
      let lo = 0, hi = segRowIndex.length - 1, found = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const s = segRowIndex[mid]
        if (s.end <= t)       lo = mid + 1
        else if (s.start > t) hi = mid - 1
        else                  { found = mid; break }
      }
      if (found !== _activeIdx) {
        if (_activeIdx >= 0) segRowIndex[_activeIdx].el.classList.remove('seg-row--playing')
        if (found >= 0)      segRowIndex[found].el.classList.add('seg-row--playing')
        _activeIdx = found
      }
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
    rightPanelEl = makeRightPanel(transcript, knownSpeakers, transcriptId, reload, audio, suggestions, playerAbortCtrl.signal)
    root.appendChild(rightPanelEl)
  }

  // Pause audio when navigating away
  root._cleanup = () => { audio.pause(); if (playerAbortCtrl) playerAbortCtrl.abort() }

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
