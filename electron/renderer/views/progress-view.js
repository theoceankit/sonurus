function renderProgressView(jobId) {
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

  // Connect WebSocket
  const ws = new WebSocket(`${WS_BASE}/ws/${jobId}`)

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
      setTimeout(() => app.showEditor(event.transcript_id), 600)
    } else if (event.type === 'cancelled') {
      stopAndReturn()
    } else if (event.type === 'error') {
      cancelBtn.style.display = 'none'
      fill.classList.remove('progress-bar-fill--indeterminate')
      fill.style.background = '#C0392B'
      fill.style.width = '100%'
      step.textContent = `Error: ${event.message}`
      title.textContent = 'Transcription failed'
    }
  }

  ws.onerror = () => {
    cancelBtn.style.display = 'none'
    step.textContent = 'Lost connection to API server'
    title.textContent = 'Connection error'
  }

  return el
}
