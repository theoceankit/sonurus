// ── Alignment Model Modal ─────────────────────────────────────────────────────
// Shown when a background transcription job fails with alignment_model_missing.
// Lets the user download the required model and retry without navigating away.
//
// One dialog per language: further failures for that language reuse the open
// one (several queued jobs often fail on the same model). The download is the
// app's (model-downloads.js), so there is one per model, Settings shows it,
// and a download started in Settings shows here too. Once the model is
// installed, one button retries every job that failed for it.

const _alignmentModals = {}   // language → { refresh, close }

// Failed jobs waiting for this language's alignment model, in queue order.
function alignmentRetryJobs(lang, snapshot) {
  return (snapshot?.jobs || []).filter(j =>
    j.status === 'failed' && j.error_code === 'alignment_model_missing' && j.error_language === lang)
}

function alignmentRetryLabel(count) {
  return count === 1 ? 'Retry transcription' : `Retry ${count} transcriptions`
}

// offer | downloading | ready | failed (the last download of it did not finish).
function alignmentModalState(lang) {
  if (modelDownload(lang)) return 'downloading'
  if (modelState()?.models.some(m => m.kind === 'alignment' && m.id === lang && m.installed)) return 'ready'
  return _alignmentModals[lang]?.failed ? 'failed' : 'offer'
}

// Opens the dialog for `lang`, or brings the open one up to date.
function showAlignmentModal(lang) {
  const open = _alignmentModals[lang]
  if (open) {
    open.refresh()
    return open.overlay
  }

  const alignModel = ALIGNMENT_MODELS.find(m => m.id === lang) || {}
  const langName   = alignModel.name       || lang
  const langNative = alignModel.nativeName || ''
  const langSize   = alignModel.size       || ''

  const overlay = document.createElement('div')
  overlay.className = 'nr-overlay'

  const box = document.createElement('div')
  box.className = 'am-modal'

  const entry = { overlay, failed: false, refresh, close }
  let wasDownloading = !!modelDownload(lang)

  function onEsc(e) { if (e.key === 'Escape') close() }
  function close() {
    document.removeEventListener('keydown', onEsc)
    unsubscribe()
    if (_alignmentModals[lang] === entry) delete _alignmentModals[lang]
    overlay.remove()
  }
  document.addEventListener('keydown', onEsc)

  const titleEl = document.createElement('div')
  titleEl.className = 'am-modal__title'

  const desc = document.createElement('div')
  desc.className = 'am-modal__desc'

  const dlTrack = document.createElement('div')
  dlTrack.className = 'progress-bar-track'
  const dlFill = document.createElement('div')
  dlFill.className = 'progress-bar-fill'
  dlFill.style.cssText = 'width:0%;transition:width 0.6s ease'
  dlTrack.appendChild(dlFill)

  const pctEl = document.createElement('div')
  pctEl.className = 'am-modal__pct'

  const btnRow = document.createElement('div')
  btnRow.className = 'am-modal__buttons'

  box.appendChild(titleEl)
  box.appendChild(desc)
  box.appendChild(dlTrack)
  box.appendChild(pctEl)
  box.appendChild(btnRow)
  overlay.appendChild(box)

  function button(cls, html, onClick) {
    const btn = document.createElement('button')
    btn.className = `st-btn ${cls}`
    btn.innerHTML = html
    btn.addEventListener('click', onClick)
    btnRow.appendChild(btn)
    return btn
  }

  function showProgress(visible) {
    dlTrack.style.display = visible ? '' : 'none'
    pctEl.style.display   = visible ? '' : 'none'
  }

  function offerDownload() {
    button('st-btn--primary', `${icon('download', 11)} Download${langSize ? ' ' + langSize : ''}`, () => {
      entry.failed = false
      startModelDownload(lang)
    })
    button('st-btn--ghost', '← Dismiss', close)
  }

  function refresh() {
    const state = alignmentModalState(lang)
    btnRow.innerHTML = ''
    showProgress(state === 'downloading')

    if (state === 'downloading') {
      const pct = modelDownload(lang).pct ?? 0
      titleEl.textContent = `Downloading ${langName} alignment model…`
      desc.textContent    = 'This may take a few minutes.'
      dlFill.style.width  = pct + '%'
      pctEl.textContent   = Math.round(pct) + '%'
      const cancelBtn = button('st-btn--ghost', 'Cancel', () => {
        cancelBtn.disabled = true
        cancelBtn.textContent = 'Cancelling…'
        cancelModelDownload(lang).finally(close)
      })

    } else if (state === 'ready') {
      const jobs = alignmentRetryJobs(lang, app._queue)
      titleEl.textContent = '✓ Download complete'
      desc.textContent    = `${langName} alignment model is ready.`
      if (jobs.length) {
        const retryBtn = button('st-btn--primary', `${icon('retry', 11)} ${alignmentRetryLabel(jobs.length)}`, async () => {
          retryBtn.disabled = true
          close()
          // Each failed job goes back to the end of the queue, in queue order.
          for (const j of jobs) await app._queueRequest(`/queue/jobs/${j.id}/retry`)
        })
      }
      button('st-btn--ghost', '← Close', close)

    } else if (state === 'failed') {
      titleEl.textContent = 'Download failed'
      desc.textContent    = 'Try again or go to Settings → Alignment Models.'
      offerDownload()

    } else {
      titleEl.textContent = 'Alignment model required'
      desc.innerHTML = [
        `<strong>${langName}${langNative ? ` · ${langNative}` : ''}</strong>`,
        langSize ? ` <span class="am-modal__size">${langSize}</span>` : '',
        `<br>Download it to get word-level timestamps for this language.`,
      ].join('')
      offerDownload()
    }
  }

  const unsubscribe = subscribeModelDownloads(id => {
    if (id !== lang) return
    const downloading = !!modelDownload(lang)
    // Ended without installing the model: an error (a cancel closes the dialog).
    if (wasDownloading && !downloading && alignmentModalState(lang) !== 'ready') entry.failed = true
    wasDownloading = downloading
    refresh()
  })

  _alignmentModals[lang] = entry
  refresh()
  document.body.appendChild(overlay)
  return overlay
}

// Queue snapshots change which jobs a ready dialog retries.
function refreshAlignmentModals() {
  Object.values(_alignmentModals).forEach(m => m.refresh())
}
