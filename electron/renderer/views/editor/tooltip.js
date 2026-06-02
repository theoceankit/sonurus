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

function attachSegTooltip(btn, placement = 'above') {
  btn.addEventListener('mouseenter', () => {
    const text = btn.getAttribute('data-tooltip')
    if (!text) return
    const tt = _getTooltip()
    tt.textContent = text
    tt.classList.remove('seg-tooltip--visible', 'seg-tooltip--below')
    tt.style.left = '-10499px'
    tt.style.top = '-10499px'

    requestAnimationFrame(() => {
      const bRect = btn.getBoundingClientRect()
      const tRect = tt.getBoundingClientRect()
      const idealLeft = bRect.left + bRect.width / 2 - tRect.width / 2
      const left = Math.max(8, Math.min(idealLeft, window.innerWidth - tRect.width - 8))
      const top = placement === 'below'
        ? bRect.bottom + 8
        : bRect.top - tRect.height - 8

      const arrowLeft = bRect.left + bRect.width / 2 - left
      tt.style.setProperty('--arrow-left', arrowLeft + 'px')
      tt.style.left = left + 'px'
      tt.style.top = top + 'px'
      if (placement === 'below') tt.classList.add('seg-tooltip--below')
      tt.classList.add('seg-tooltip--visible')
    })
  })
  btn.addEventListener('mouseleave', () => {
    const tt = _getTooltip()
    tt.classList.remove('seg-tooltip--visible')
  })
}
