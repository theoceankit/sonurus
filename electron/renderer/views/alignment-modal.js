// ── Alignment Model Modal ─────────────────────────────────────────────────────
// Shown when a background transcription job fails with alignment_model_missing.
// Lets the user download the required model and retry without navigating away.

function renderAlignmentModal(lang, originalRequest) {
  const alignModel = ALIGNMENT_MODELS.find(m => m.id === lang) || {}
  const langName   = alignModel.name       || lang
  const langNative = alignModel.nativeName || ''
  const langSize   = alignModel.size       || ''

  const overlay = document.createElement('div')
  overlay.className = 'nr-overlay'

  const box = document.createElement('div')
  box.className = 'am-modal'

  function onEsc(e) { if (e.key === 'Escape') close() }
  function close() {
    document.removeEventListener('keydown', onEsc)
    overlay.remove()
  }
  document.addEventListener('keydown', onEsc)

  const titleEl = document.createElement('div')
  titleEl.className = 'am-modal__title'
  titleEl.textContent = 'Alignment model required'

  const desc = document.createElement('div')
  desc.className = 'am-modal__desc'
  desc.innerHTML = [
    `<strong>${langName}${langNative ? ` · ${langNative}` : ''}</strong>`,
    langSize ? ` <span class="am-modal__size">${langSize}</span>` : '',
    `<br>Download it to get word-level timestamps for this language.`,
  ].join('')

  const dlTrack = document.createElement('div')
  dlTrack.className = 'progress-bar-track'
  dlTrack.style.display = 'none'
  const dlFill = document.createElement('div')
  dlFill.className = 'progress-bar-fill'
  dlFill.style.cssText = 'width:0%;transition:width 0.6s ease'
  dlTrack.appendChild(dlFill)

  const pctEl = document.createElement('div')
  pctEl.className = 'am-modal__pct'
  pctEl.style.display = 'none'

  const btnRow = document.createElement('div')
  btnRow.className = 'am-modal__buttons'

  const dlBtn = document.createElement('button')
  dlBtn.className = 'st-btn st-btn--primary'
  dlBtn.innerHTML = [
    `<svg width="11" height="11" viewBox="0 0 12 12" fill="none">`,
    `<path d="M6 1v7M3 6l3 3 3-3M2 11h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
    `</svg> Download${langSize ? ' ' + langSize : ''}`,
  ].join('')

  const dismissBtn = document.createElement('button')
  dismissBtn.className = 'st-btn st-btn--ghost'
  dismissBtn.textContent = '← Dismiss'
  dismissBtn.addEventListener('click', close)

  btnRow.appendChild(dlBtn)
  btnRow.appendChild(dismissBtn)

  box.appendChild(titleEl)
  box.appendChild(desc)
  box.appendChild(dlTrack)
  box.appendChild(pctEl)
  box.appendChild(btnRow)
  overlay.appendChild(box)

  dlBtn.addEventListener('click', () => {
    dlBtn.disabled      = true
    dismissBtn.disabled = true
    dlTrack.style.display = ''
    pctEl.style.display   = ''
    titleEl.textContent = `Downloading ${langName} alignment model…`
    desc.textContent    = 'This may take a few minutes.'

    const cancelDlBtn = document.createElement('button')
    cancelDlBtn.className = 'st-btn st-btn--ghost'
    cancelDlBtn.textContent = 'Cancel'
    btnRow.innerHTML = ''
    btnRow.appendChild(cancelDlBtn)

    fetch(`${API_BASE}/models/${lang}/download`, { method: 'POST' })
      .then(r => r.json())
      .then(({ job_id: dlJobId }) => {
        const dlWs = new WebSocket(`${WS_BASE}/ws/models/${dlJobId}`)

        cancelDlBtn.addEventListener('click', () => {
          cancelDlBtn.disabled    = true
          cancelDlBtn.textContent = 'Cancelling…'
          fetch(`${API_BASE}/models/${lang}/download/${dlJobId}`, { method: 'DELETE' })
            .finally(() => { dlWs.close(); close() })
        })

        dlWs.onmessage = ({ data }) => {
          const ev = JSON.parse(data)
          if (ev.type === 'heartbeat') return

          if (ev.type === 'progress') {
            const pct = ev.pct ?? 0
            dlFill.style.width = pct + '%'
            pctEl.textContent  = Math.round(pct) + '%'

          } else if (ev.type === 'done') {
            dlWs.close()
            dlTrack.style.display = 'none'
            pctEl.style.display   = 'none'
            titleEl.textContent = '✓ Download complete'
            desc.textContent    = `${langName} alignment model is ready.`

            btnRow.innerHTML = ''
            if (originalRequest) {
              const retryBtn = document.createElement('button')
              retryBtn.className = 'st-btn st-btn--primary'
              retryBtn.innerHTML = [
                `<svg width="11" height="11" viewBox="0 0 12 12" fill="none">`,
                `<path d="M2 6a4 4 0 104-4H4M4 2v3h3" stroke="currentColor"`,
                ` stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
                `</svg> Retry transcription`,
              ].join('')
              retryBtn.addEventListener('click', () => {
                retryBtn.disabled = true
                close()
                fetch(`${API_BASE}/transcribe`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(originalRequest),
                })
                  .then(r => r.json())
                  .then(({ job_id }) => app._addJob(job_id, originalRequest))
                  .catch(() => window.showToast?.('Could not start transcription', 'error'))
              })
              btnRow.appendChild(retryBtn)
            }
            const closeBtn = document.createElement('button')
            closeBtn.className = 'st-btn st-btn--ghost'
            closeBtn.textContent = '← Close'
            closeBtn.addEventListener('click', close)
            btnRow.appendChild(closeBtn)

          } else if (ev.type === 'cancelled' || ev.type === 'error') {
            dlWs.close()
            dlTrack.style.display = 'none'
            pctEl.style.display   = 'none'
            titleEl.textContent = 'Download failed'
            desc.textContent    = 'Try again or go to Settings → Alignment Models.'
            btnRow.innerHTML    = ''
            const closeBtn = document.createElement('button')
            closeBtn.className = 'st-btn st-btn--ghost'
            closeBtn.textContent = '← Close'
            closeBtn.addEventListener('click', close)
            btnRow.appendChild(closeBtn)
          }
        }

        dlWs.onerror = () => {
          dlTrack.style.display = 'none'
          pctEl.style.display   = 'none'
          titleEl.textContent = 'Connection error'
          desc.textContent    = 'Lost connection to the download service.'
          btnRow.innerHTML    = ''
          const closeBtn = document.createElement('button')
          closeBtn.className = 'st-btn st-btn--ghost'
          closeBtn.textContent = '← Close'
          closeBtn.addEventListener('click', close)
          btnRow.appendChild(closeBtn)
        }
      })
      .catch(() => {
        dlTrack.style.display = 'none'
        pctEl.style.display   = 'none'
        titleEl.textContent = 'Could not start download'
        desc.textContent    = 'Check that the API server is running.'
        btnRow.innerHTML    = ''
        btnRow.appendChild(dlBtn)
        btnRow.appendChild(dismissBtn)
        dlBtn.disabled      = false
        dismissBtn.disabled = false
      })
  })

  return overlay
}
