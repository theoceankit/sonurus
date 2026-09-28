// ── Window file drop ─────────────────────────────────────────────────────────
// Audio files dropped anywhere on the window are queued for transcription.
// dropDecision() (utils.js) decides what a drop does; this wires the window
// events and the overlay shown over #main-panel while files are dragged.
// Only drags that carry files are touched, so text drags keep working.

function initFileDrop({ getState, onDrop }) {
  const overlay = document.createElement('div')
  overlay.className = 'fd-overlay'
  overlay.innerHTML = `
    <svg class="nr-drop-border" aria-hidden="true">
      <rect width="100%" height="100%" rx="14" ry="14" fill="none"
        stroke="currentColor" stroke-width="3" stroke-dasharray="18,10" stroke-linecap="round"/>
    </svg>
    ${icon('import', 28)}
    <span class="fd-overlay-label">Drop audio files to transcribe</span>`
  document.body.appendChild(overlay)

  let depth = 0
  const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files')
  const decide = (files = []) => dropDecision({ ...getState(), files })

  function show() {
    if (decide().action === 'ignore') return
    const r = document.getElementById('main-panel').getBoundingClientRect()
    Object.assign(overlay.style, {
      top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`,
    })
    overlay.classList.add('fd-overlay--active')
  }

  function hide() {
    depth = 0
    overlay.classList.remove('fd-overlay--active')
  }

  window.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return
    e.preventDefault()
    if (++depth === 1) show()
  })
  window.addEventListener('dragleave', e => {
    if (!hasFiles(e)) return
    if (--depth <= 0) hide()
  })
  // Always cancelled: an unhandled file drop makes Electron open the file
  // in the window instead of the app.
  window.addEventListener('dragover', e => {
    if (!hasFiles(e)) return
    e.preventDefault()
    if (getState().modalOpen) return // the modal sets its own drop effect
    e.dataTransfer.dropEffect = decide().action === 'ignore' ? 'none' : 'copy'
  })
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return
    // A drop zone below (the New Recording modal) took it and may already
    // have closed itself, so modalOpen would be false by now.
    const handled = e.defaultPrevented
    e.preventDefault()
    hide()
    if (handled) return
    const files = Array.from(e.dataTransfer.files)
      .map(file => ({ name: file.name, path: window.electronAPI.getFilePath(file) }))
      .filter(file => file.path)
    onDrop(decide(files))
  })
}
