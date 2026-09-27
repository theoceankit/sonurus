// ── Dropdown ────────────────────────────────────────────────────────────────────
// Generic dropdown used in new-recording-modal and settings-view.

function makeDropdown(options, value, onChange, renderOption) {
  const wrap = document.createElement('div')
  wrap.className = 'st-dropdown'
  wrap.style.position = 'relative'

  const trigger = document.createElement('button')
  trigger.className = 'st-dropdown-trigger'

  const valSpan = document.createElement('span')
  valSpan.className = 'st-dropdown-value'
  const chevron = document.createElement('span')
  chevron.className = 'st-dropdown-chevron'
  chevron.innerHTML = `<svg width="10" height="6" viewBox="0 0 10 6" fill="none">
    <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`
  trigger.appendChild(valSpan)
  trigger.appendChild(chevron)

  const list = document.createElement('div')
  list.className = 'st-dropdown-list quiet-scroll'
  list.style.display = 'none'

  function setVal(v) {
    const opt = options.find(o => o.value === v)
    if (opt) {
      valSpan.innerHTML = ''
      const rendered = renderOption ? renderOption(opt, true) : document.createTextNode(opt.label)
      valSpan.appendChild(rendered)
    }
  }

  function buildList(current) {
    list.innerHTML = ''
    options.forEach(opt => {
      const item = document.createElement('button')
      item.className = 'st-dropdown-item' + (opt.value === current ? ' st-dropdown-item--active' : '')
      if (renderOption) {
        item.appendChild(renderOption(opt, false))
      } else {
        item.textContent = opt.label
      }
      if (opt.value === current) {
        const check = document.createElement('span')
        check.className = 'st-dropdown-check'
        check.innerHTML = `<svg width="11" height="9" viewBox="0 0 11 9" fill="none">
          <path d="M1 4.5l3 3 6-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`
        item.appendChild(check)
      }
      item.addEventListener('click', () => {
        onChange(opt.value)
        setVal(opt.value)
        buildList(opt.value)
        closeList()
      })
      list.appendChild(item)
    })
  }

  let currentVal = value
  setVal(value)
  buildList(value)

  let open = false
  function openList() {
    open = true
    list.style.display = 'block'
    chevron.style.transform = 'rotate(180deg)'
    const closeOnClick = (e) => {
      if (!wrap.contains(e.target)) closeList()
    }
    setTimeout(() => document.addEventListener('mousedown', closeOnClick, { once: true }), 0)
  }
  function closeList() {
    open = false
    list.style.display = 'none'
    chevron.style.transform = ''
  }

  trigger.addEventListener('click', () => open ? closeList() : openList())

  wrap.appendChild(trigger)
  wrap.appendChild(list)
  return wrap
}

// ── Confirm dialog ──────────────────────────────────────────────────────────────
// Modal with Cancel + a red confirm button. onConfirm may return a promise;
// the dialog closes when it settles. Escape / backdrop click cancel.

function openConfirmDialog({ title, body, confirmLabel = 'Delete', onConfirm }) {
  const overlay = document.createElement('div')
  overlay.className = 'nr-overlay'

  const modal = document.createElement('div')
  modal.className = 'nr-modal confirm-modal'
  modal.setAttribute('role', 'alertdialog')

  const h = document.createElement('div')
  h.className = 'confirm-title'
  h.textContent = title
  const p = document.createElement('div')
  p.className = 'confirm-body'
  p.textContent = body

  const btns = document.createElement('div')
  btns.className = 'confirm-btns'
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'st-btn st-btn--ghost'
  cancelBtn.textContent = 'Cancel'
  const confirmBtn = document.createElement('button')
  confirmBtn.className = 'st-btn st-btn--danger'
  confirmBtn.textContent = confirmLabel
  btns.append(cancelBtn, confirmBtn)

  modal.append(h, p, btns)
  overlay.appendChild(modal)

  function onEsc(e) { if (e.key === 'Escape') close() }
  function close() {
    document.removeEventListener('keydown', onEsc)
    overlay.remove()
  }
  document.addEventListener('keydown', onEsc)
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close() })
  cancelBtn.addEventListener('click', close)
  confirmBtn.addEventListener('click', async () => {
    cancelBtn.disabled = confirmBtn.disabled = true
    try { await onConfirm() } finally { close() }
  })

  document.body.appendChild(overlay)
  confirmBtn.focus()
  return overlay
}
