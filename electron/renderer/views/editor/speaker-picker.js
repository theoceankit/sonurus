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
