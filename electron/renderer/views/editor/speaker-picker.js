// ── Speaker picker popup ──────────────────────────────────────────────────────
// currentName: display name of currentSpkId (shown by the new speaker modal).
// segmentStart: set when opened from a segment row — assigns only that segment.
function showSpeakerPicker(anchorEl, currentSpkId, knownSpeakers, transcriptId, onReload, { segmentStart = null, currentName = '' } = {}) {
  document.getElementById('_spk-picker')?.remove()
  const _pickerKnownMap = buildKnownMap(knownSpeakers)
  // Speakers sharing a name are told apart by their usage line
  const _sameName = duplicateNameIds(knownSpeakers)

  const popup = document.createElement('div')
  popup.id = '_spk-picker'
  popup.className = 'spk-picker'

  // Search row
  const searchWrap = document.createElement('div')
  searchWrap.className = 'spk-picker-search-wrap'

  const searchIcon = document.createElement('span')
  searchIcon.className = 'spk-picker-search-icon'
  searchIcon.innerHTML = icon('search', 13)

  const search = document.createElement('input')
  search.className = 'spk-picker-search'
  search.placeholder = 'Search speakers'

  const clearBtn = document.createElement('button')
  clearBtn.className = 'spk-picker-clear'
  clearBtn.style.display = 'none'
  clearBtn.innerHTML = icon('close', 7)
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
  newAv.innerHTML = icon('add', 12)

  const newLabel = document.createElement('span')
  newLabel.className = 'spk-picker-new-label'
  newLabel.textContent = 'Add new speaker…'

  newBtn.appendChild(newAv)
  newBtn.appendChild(newLabel)
  footer.appendChild(newBtn)
  popup.appendChild(footer)

  newBtn.addEventListener('mousedown', e => {
    e.preventDefault()
    openNewSpeakerDialog()
  })

  // The picker closes; the modal takes over, prefilled with what was typed.
  function openNewSpeakerDialog() {
    const initialName = search.value
    popup.remove()
    openNewSpeakerModal({
      initialName,
      knownSpeakers,
      fromName: currentName,
      segmentScope: segmentStart !== null,
      onSubmit: ({ name, colorIndex, scope }) => requestAssign(
        { name, colorIndex }, scope === 'segment' ? segmentStart : null,
      ).then(onReload),
    })
  }

  let focusIdx = 0
  let keyboardNav = false

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
      const p = speakerPalette(s.id, _pickerKnownMap)
      av.style.background = p.color
      av.textContent = speakerInitials(s.name)

      const nm = document.createElement('span')
      nm.className = 'spk-picker-item-name'
      nm.textContent = s.name
      if (_sameName.has(s.id)) {
        const meta = document.createElement('span')
        meta.className = 'spk-picker-item-meta'
        meta.textContent = speakerStatsLine(s)
        nm.appendChild(meta)
      }

      row.appendChild(av)
      row.appendChild(nm)

      if (s.id === currentSpkId) {
        const check = document.createElement('span')
        check.className = 'spk-picker-check'
        check.innerHTML = icon('check', 11)
        row.appendChild(check)
      }

      row.addEventListener('mouseenter', () => {
        if (keyboardNav) return
        focusIdx = i
        list.querySelectorAll('.spk-picker-item--focused').forEach(el => el.classList.remove('spk-picker-item--focused'))
        row.classList.add('spk-picker-item--focused')
      })
      row.addEventListener('mousemove', () => { keyboardNav = false })
      row.addEventListener('mousedown', e => {
        e.preventDefault()
        if (s.id === currentSpkId) { popup.remove(); return }
        assignSpeaker({ id: s.id })
      })
      list.appendChild(row)
    })
  }

  function requestAssign(target, start) {
    const { url, method, body } = speakerAssignRequest({
      transcriptId, fromSpeakerId: currentSpkId, segmentStart: start, target,
    })
    return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => { if (!r.ok) throw new Error(`Failed to assign speaker (${r.status})`) })
  }

  function assignSpeaker(target) {
    requestAssign(target, segmentStart)
      .then(() => { popup.remove(); onReload() })
      .catch(err => window.showToast?.(err.message, 'error'))
  }

  buildList('')

  search.addEventListener('input', () => {
    clearBtn.style.display = search.value ? '' : 'none'
    buildList(search.value, 0)
  })

  search.addEventListener('keydown', e => {
    const items = [...list.querySelectorAll('.spk-picker-item')]
    if (e.key === 'Escape') { e.preventDefault(); popup.remove(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      keyboardNav = true
      focusIdx = Math.min(focusIdx + 1, items.length - 1)
      items.forEach((el, i) => el.classList.toggle('spk-picker-item--focused', i === focusIdx))
      items[focusIdx]?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      keyboardNav = true
      focusIdx = Math.max(focusIdx - 1, 0)
      items.forEach((el, i) => el.classList.toggle('spk-picker-item--focused', i === focusIdx))
      items[focusIdx]?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const focused = items[focusIdx]
      if (focused) focused.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      else if (search.value.trim()) openNewSpeakerDialog()  // nothing matches → create it
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
