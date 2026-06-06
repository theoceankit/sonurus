function renderProgressView(jobId, originalRequest = null) {
  const el = document.createElement('div')
  el.className = 'progress-view'

  const title = document.createElement('div')
  title.className = 'progress-view__title'
  title.textContent = 'Transcribing…'

  const step = document.createElement('div')
  step.className = 'progress-view__step'
  step.textContent = 'Connecting…'

  const track = document.createElement('div')
  track.className = 'progress-bar-track'
  const fill = document.createElement('div')
  fill.className = 'progress-bar-fill progress-bar-fill--indeterminate'
  track.appendChild(fill)

  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'progress-view__cancel'
  cancelBtn.textContent = 'Cancel'

  el.appendChild(title)
  el.appendChild(track)
  el.appendChild(step)
  el.appendChild(cancelBtn)

  // ── WebSocket ──────────────────────────────────────────────────────────────
  const ws = new WebSocket(`${WS_BASE}/ws/${jobId}`)
  el._cleanup = () => ws.close()

  function stopAndReturn() {
    ws.close()
    app.showImport()
  }

  cancelBtn.addEventListener('click', () => {
    cancelBtn.disabled = true
    cancelBtn.textContent = 'Cancelling…'
    fetch(`${API_BASE}/transcribe/${jobId}`, { method: 'DELETE' })
      .catch(() => {})
      .finally(() => stopAndReturn())
  })

  // ── Alignment model prompt ─────────────────────────────────────────────────
  // Shown when transcription detects a language whose alignment model is not
  // installed.  Lets the user download the model and retry without leaving
  // the progress view.
  function showAlignmentPrompt(lang) {
    const alignModel = ALIGNMENT_MODELS.find(m => m.id === lang) || {}
    const langName   = alignModel.name       || lang
    const langNative = alignModel.nativeName || ''
    const langSize   = alignModel.size       || ''

    // Transform existing elements into the prompt state
    title.textContent = 'Alignment model required'
    track.style.display  = 'none'
    cancelBtn.style.display = 'none'
    step.innerHTML = [
      `<strong>${langName}${langNative ? ` · ${langNative}` : ''}</strong>`,
      langSize ? ` <span style="opacity:0.55">${langSize}</span>` : '',
      `<br><span style="font-weight:400">Download it to get word-level timestamps.</span>`,
    ].join('')

    // Download progress bar (initially hidden)
    const dlTrack = document.createElement('div')
    dlTrack.className = 'progress-bar-track'
    dlTrack.style.display = 'none'
    const dlFill = document.createElement('div')
    dlFill.className = 'progress-bar-fill'
    dlFill.style.cssText = 'width:0%;transition:width 0.6s ease'
    dlTrack.appendChild(dlFill)

    const pctEl = document.createElement('div')
    pctEl.style.cssText = [
      'font-size:12px;color:rgba(25,24,42,0.5);text-align:center',
      'margin-top:3px;font-family:ui-monospace,monospace;display:none',
    ].join(';')

    // Action buttons
    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:10px'

    const dlBtn = document.createElement('button')
    dlBtn.className = 'st-btn st-btn--primary'
    dlBtn.innerHTML = [
      `<svg width="11" height="11" viewBox="0 0 12 12" fill="none">`,
      `<path d="M6 1v7M3 6l3 3 3-3M2 11h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
      `</svg> Download${langSize ? ' ' + langSize : ''}`,
    ].join('')

    const backBtn = document.createElement('button')
    backBtn.className = 'st-btn st-btn--ghost'
    backBtn.textContent = '← Back'
    backBtn.addEventListener('click', () => app.showImport())

    btnRow.appendChild(dlBtn)
    btnRow.appendChild(backBtn)

    el.appendChild(dlTrack)
    el.appendChild(pctEl)
    el.appendChild(btnRow)

    // ── Start download ───────────────────────────────────────────────────────
    dlBtn.addEventListener('click', () => {
      dlBtn.disabled  = true
      backBtn.disabled = true
      dlTrack.style.display = ''
      pctEl.style.display   = ''
      title.textContent = `Downloading ${langName} alignment model…`
      step.textContent  = 'This may take a few minutes.'

      const cancelDlBtn = document.createElement('button')
      cancelDlBtn.className = 'progress-view__cancel'
      cancelDlBtn.textContent = 'Cancel'
      el.appendChild(cancelDlBtn)

      fetch(`${API_BASE}/models/${lang}/download`, { method: 'POST' })
        .then(r => r.json())
        .then(({ job_id: dlJobId }) => {
          const dlWs = new WebSocket(`${WS_BASE}/ws/models/${dlJobId}`)

          cancelDlBtn.addEventListener('click', () => {
            cancelDlBtn.disabled  = true
            cancelDlBtn.textContent = 'Cancelling…'
            fetch(`${API_BASE}/models/${lang}/download/${dlJobId}`, { method: 'DELETE' })
              .finally(() => { dlWs.close(); app.showImport() })
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
              cancelDlBtn.remove()
              dlTrack.style.display = 'none'
              pctEl.style.display   = 'none'
              title.textContent = '✓ Download complete'
              step.textContent  = `${langName} alignment model is ready.`

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
                  fetch(`${API_BASE}/transcribe`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(originalRequest),
                  })
                    .then(r => r.json())
                    .then(({ job_id: newId }) => app.showProgress(newId, originalRequest))
                    .catch(() => app.showImport())
                })
                btnRow.appendChild(retryBtn)
              }
              const back2 = document.createElement('button')
              back2.className = 'st-btn st-btn--ghost'
              back2.textContent = '← Back'
              back2.addEventListener('click', () => app.showImport())
              btnRow.appendChild(back2)

            } else if (ev.type === 'cancelled' || ev.type === 'error') {
              dlWs.close()
              cancelDlBtn.remove()
              dlTrack.style.display = 'none'
              pctEl.style.display   = 'none'
              title.textContent = 'Download failed'
              step.textContent  = 'Try again from Settings → Alignment Models.'
              btnRow.innerHTML  = ''
              const back2 = document.createElement('button')
              back2.className = 'st-btn st-btn--ghost'
              back2.textContent = '← Back'
              back2.addEventListener('click', () => app.showImport())
              btnRow.appendChild(back2)
            }
          }

          dlWs.onerror = () => {
            cancelDlBtn.remove()
            dlTrack.style.display = 'none'
            pctEl.style.display   = 'none'
            title.textContent = 'Connection error'
            step.textContent  = 'Lost connection to the download service.'
            btnRow.innerHTML  = ''
            const back2 = document.createElement('button')
            back2.className = 'st-btn st-btn--ghost'
            back2.textContent = '← Back'
            back2.addEventListener('click', () => app.showImport())
            btnRow.appendChild(back2)
          }
        })
        .catch(() => {
          cancelDlBtn.remove()
          dlTrack.style.display = 'none'
          pctEl.style.display   = 'none'
          title.textContent = 'Could not start download'
          step.textContent  = 'Check that the API server is running.'
          dlBtn.disabled    = false
          backBtn.disabled  = false
        })
    })
  }

  // ── WebSocket message handler ──────────────────────────────────────────────
  ws.onmessage = (e) => {
    const event = JSON.parse(e.data)

    if (event.type === 'heartbeat') return

    if (event.type === 'progress') {
      step.textContent = event.step
    } else if (event.type === 'done') {
      cancelBtn.style.display = 'none'
      fill.classList.remove('progress-bar-fill--indeterminate')
      fill.style.width = '100%'
      step.textContent = 'Done!'
      setTimeout(() => { app.invalidateSidebar(); app.showEditor(event.transcript_id) }, 600)
    } else if (event.type === 'cancelled') {
      stopAndReturn()
    } else if (event.type === 'error') {
      ws.close()
      if (event.error_code === 'alignment_model_missing') {
        showAlignmentPrompt(event.language)
      } else {
        cancelBtn.style.display = 'none'
        fill.classList.remove('progress-bar-fill--indeterminate')
        fill.style.background = '#C0392B'
        fill.style.width = '100%'
        step.textContent  = `Error: ${event.message}`
        title.textContent = 'Transcription failed'
      }
    }
  }

  ws.onerror = () => {
    cancelBtn.style.display = 'none'
    step.textContent  = 'Lost connection to API server'
    title.textContent = 'Connection error'
  }

  return el
}
