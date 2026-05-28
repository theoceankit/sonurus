function renderLiveRecordingView() {
  let recorder    = null
  let audioCtx    = null
  let micStream   = null
  let sysStream   = null
  let chunks      = []
  let elapsed     = 0
  let timerInterval = null
  let animFrameId   = null
  let micAnalyser   = null
  let sysAnalyser   = null

  const root = document.createElement('div')
  root.className = 'import-view'

  // ── Helpers ────────────────────────────────────────────────────────────────

  function fmtTime(s) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  function getLevel(analyser) {
    if (!analyser) return 0
    const data = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(data)
    return Math.min(1, data.reduce((a, b) => a + b, 0) / data.length / 64)
  }

  function stopStreams() {
    clearInterval(timerInterval)
    cancelAnimationFrame(animFrameId)
    timerInterval = animFrameId = null
    if (recorder && recorder.state !== 'inactive') try { recorder.stop() } catch (_) {}
    micStream?.getTracks().forEach(t => t.stop())
    sysStream?.getTracks().forEach(t => t.stop())
    audioCtx?.close()
    recorder = micStream = sysStream = audioCtx = micAnalyser = sysAnalyser = null
  }

  // ── READY ──────────────────────────────────────────────────────────────────

  function showReady() {
    root.innerHTML = ''

    const hdr = document.createElement('div')
    hdr.className = 'import-page-header'
    hdr.innerHTML = `
      <div class="import-page-hdr-text">
        <div class="import-page-title">Live recording</div>
        <div class="import-page-sub">Captures microphone and system audio simultaneously.</div>
      </div>`
    root.appendChild(hdr)

    const scroll = document.createElement('div')
    scroll.className = 'import-scroll quiet-scroll'
    root.appendChild(scroll)

    const card = document.createElement('div')
    card.className = 'preflight-card'
    scroll.appendChild(card)

    // Card header
    const cardHdr = document.createElement('div')
    cardHdr.className = 'preflight-header'
    cardHdr.innerHTML = `
      <span class="preflight-pill preflight-pill--rec">
        <span class="preflight-pill-dot" style="background:#C73655"></span>LIVE
      </span>
      <span class="preflight-mode-label">Configure and start capturing</span>
      <div style="flex:1"></div>`
    card.appendChild(cardHdr)

    // Device summary
    const devWrap = document.createElement('div')
    devWrap.className = 'live-rec-devices'

    const micLabel = appSettings.recordingMicDevice ? 'Configured microphone' : 'Default microphone'
    const sysLabel = appSettings.recordingSystemDevice ? 'Configured system source' : 'System audio disabled'

    const micRow = document.createElement('div')
    micRow.className = 'live-rec-device-row'
    micRow.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 18 18" fill="none">
        <path d="M9 2a3 3 0 013 3v4a3 3 0 01-6 0V5a3 3 0 013-3z" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <path d="M4 9a5 5 0 0010 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>${micLabel}</span>
      ${appSettings.recordingUseMic ? '' : '<span class="live-rec-device-badge">off</span>'}`

    const sysRow = document.createElement('div')
    sysRow.className = 'live-rec-device-row'
    sysRow.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="6" width="14" height="8" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <path d="M6 6V5a3 3 0 016 0v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>
      </svg>
      <span>${sysLabel}</span>`

    devWrap.appendChild(micRow)
    devWrap.appendChild(sysRow)
    card.appendChild(devWrap)

    const errorEl = document.createElement('div')
    errorEl.className = 'error-banner'
    errorEl.style.display = 'none'
    card.appendChild(errorEl)

    // Footer
    const footer = document.createElement('div')
    footer.className = 'preflight-footer'

    const footInfo = document.createElement('div')
    footInfo.className = 'preflight-footer-info'
    footInfo.innerHTML = `
      <span class="sb-footer-dot"></span>
      <span>On-device · private</span>
      <span style="margin:0 4px;opacity:0.4">·</span>
      <span>Transcribed after stopping</span>`

    const cfgBtn = document.createElement('button')
    cfgBtn.className = 'st-btn st-btn--ghost'
    cfgBtn.style.cssText = 'height:36px;font-size:14px'
    cfgBtn.textContent = 'Configure devices'
    cfgBtn.addEventListener('click', () => { stopStreams(); app.showSettings() })

    const startBtn = document.createElement('button')
    startBtn.className = 'st-btn st-btn--primary'
    startBtn.style.cssText = 'height:36px;padding:0 19px;font-size:14px;gap:8px;background:linear-gradient(135deg,#EF4F6E,#F08055)'
    startBtn.innerHTML = `
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
        <circle cx="4.5" cy="4.5" r="4.5" fill="currentColor"/>
      </svg>Start recording`
    startBtn.addEventListener('click', () => startRecording(errorEl, startBtn))

    footer.appendChild(footInfo)
    footer.appendChild(cfgBtn)
    footer.appendChild(startBtn)
    card.appendChild(footer)
  }

  // ── Start recording ────────────────────────────────────────────────────────

  async function startRecording(errorEl, startBtn) {
    startBtn.disabled = true
    errorEl.style.display = 'none'

    try {
      if (appSettings.recordingUseMic) {
        const constraint = appSettings.recordingMicDevice
          ? { deviceId: { exact: appSettings.recordingMicDevice } }
          : true
        micStream = await navigator.mediaDevices.getUserMedia({ audio: constraint })
      }

      const sysDeviceId = appSettings.recordingSystemDevice
      if (sysDeviceId) {
        sysStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: sysDeviceId } } })
      }

      if (!micStream && !sysStream) {
        throw new Error('No audio source available. Check Settings → Audio devices.')
      }

      audioCtx = new AudioContext()
      const dest = audioCtx.createMediaStreamDestination()

      function tap(stream) {
        const src = audioCtx.createMediaStreamSource(stream)
        const an = audioCtx.createAnalyser()
        an.fftSize = 256
        src.connect(an)
        src.connect(dest)
        return an
      }
      if (micStream) micAnalyser = tap(micStream)
      if (sysStream) sysAnalyser = tap(sysStream)

      chunks = []
      recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' })
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.start(1000)

      showRecording()
    } catch (err) {
      startBtn.disabled = false
      errorEl.textContent = err.message
      errorEl.style.display = 'block'
      stopStreams()
    }
  }

  // ── RECORDING ──────────────────────────────────────────────────────────────

  function showRecording() {
    root.innerHTML = ''
    elapsed = 0

    const hdr = document.createElement('div')
    hdr.className = 'import-page-header'
    hdr.innerHTML = `
      <div class="import-page-hdr-text">
        <div class="import-page-title" style="display:flex;align-items:center;gap:10px">
          <span class="live-rec-dot"></span>Recording
        </div>
        <div class="import-page-sub">Stop at any time — you'll review before transcribing.</div>
      </div>`
    root.appendChild(hdr)

    const scroll = document.createElement('div')
    scroll.className = 'import-scroll quiet-scroll'
    root.appendChild(scroll)

    const card = document.createElement('div')
    card.className = 'preflight-card'
    scroll.appendChild(card)

    // Timer
    const timerEl = document.createElement('div')
    timerEl.className = 'live-rec-timer'
    timerEl.textContent = '0:00'
    card.appendChild(timerEl)

    // VU meters
    const metersWrap = document.createElement('div')
    metersWrap.className = 'live-rec-meters'

    function makeMeterRow(label) {
      const row = document.createElement('div')
      row.className = 'live-rec-meter-row'
      const lbl = document.createElement('span')
      lbl.className = 'live-rec-meter-label'
      lbl.textContent = label
      const track = document.createElement('div')
      track.className = 'live-rec-meter-track'
      const fill = document.createElement('div')
      fill.className = 'live-rec-meter-fill'
      track.appendChild(fill)
      row.appendChild(lbl)
      row.appendChild(track)
      return { row, fill }
    }

    const micBar = micStream ? makeMeterRow('Mic') : null
    const sysBar = sysStream ? makeMeterRow('System') : null
    if (micBar) metersWrap.appendChild(micBar.row)
    if (sysBar) metersWrap.appendChild(sysBar.row)
    card.appendChild(metersWrap)

    // Stop button
    const stopBtn = document.createElement('button')
    stopBtn.className = 'st-btn st-btn--ghost'
    stopBtn.style.cssText = 'margin-top:8px;gap:8px;align-self:flex-start'
    stopBtn.innerHTML = `
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <rect width="10" height="10" rx="2" fill="currentColor"/>
      </svg>Stop recording`
    stopBtn.addEventListener('click', () => {
      stopBtn.disabled = true
      clearInterval(timerInterval)
      cancelAnimationFrame(animFrameId)
      timerInterval = animFrameId = null
      recorder.onstop = () => finishRecording(elapsed)
      recorder.stop()
    })
    card.appendChild(stopBtn)

    // Tick timer
    timerInterval = setInterval(() => {
      elapsed++
      timerEl.textContent = fmtTime(elapsed)
    }, 1000)

    // Animate VU meters
    function tick() {
      if (micBar) micBar.fill.style.width = Math.round(getLevel(micAnalyser) * 100) + '%'
      if (sysBar) sysBar.fill.style.width = Math.round(getLevel(sysAnalyser) * 100) + '%'
      animFrameId = requestAnimationFrame(tick)
    }
    animFrameId = requestAnimationFrame(tick)
  }

  // ── Finish: save blob to disk, then show REVIEW ────────────────────────────

  async function finishRecording(duration) {
    micStream?.getTracks().forEach(t => t.stop())
    sysStream?.getTracks().forEach(t => t.stop())
    audioCtx?.close()
    micStream = sysStream = audioCtx = micAnalyser = sysAnalyser = null

    root.innerHTML = ''
    const saving = document.createElement('div')
    saving.className = 'progress-view'
    saving.innerHTML = `
      <div class="progress-view__title">Saving…</div>
      <div class="progress-view__step">Writing recording to disk</div>`
    root.appendChild(saving)

    let filePath = null
    try {
      const blob = new Blob(chunks, { type: 'audio/webm;codecs=opus' })
      filePath = await window.electronAPI.saveRecording(await blob.arrayBuffer(), 'webm')
    } catch (err) {
      root.innerHTML = ''
      const errView = document.createElement('div')
      errView.className = 'progress-view'
      const errBanner = document.createElement('div')
      errBanner.className = 'error-banner'
      errBanner.style.display = 'block'
      errBanner.textContent = `Failed to save recording: ${err.message}`
      const backBtn = document.createElement('button')
      backBtn.className = 'progress-view__cancel'
      backBtn.textContent = '← Back'
      backBtn.addEventListener('click', () => app.showImport())
      errView.appendChild(errBanner)
      errView.appendChild(backBtn)
      root.appendChild(errView)
      return
    }

    showReview(filePath, duration)
  }

  // ── REVIEW ─────────────────────────────────────────────────────────────────

  function showReview(filePath, duration) {
    root.innerHTML = ''

    const hdr = document.createElement('div')
    hdr.className = 'import-page-header'
    hdr.innerHTML = `
      <div class="import-page-hdr-text">
        <div class="import-page-title">Recording complete</div>
        <div class="import-page-sub">${fmtTime(duration)} captured · ready to transcribe</div>
      </div>`
    root.appendChild(hdr)

    const scroll = document.createElement('div')
    scroll.className = 'import-scroll quiet-scroll'
    root.appendChild(scroll)

    const card = document.createElement('div')
    card.className = 'preflight-card'
    scroll.appendChild(card)

    const cardHdr = document.createElement('div')
    cardHdr.className = 'preflight-header'
    cardHdr.innerHTML = `
      <span class="preflight-pill preflight-pill--ok">
        <span class="preflight-pill-dot" style="background:#1F8A66"></span>RECORDED
      </span>
      <span class="preflight-mode-label">${fmtTime(duration)}</span>
      <div style="flex:1"></div>`
    card.appendChild(cardHdr)

    // Title input
    const titleLabelRow = document.createElement('div')
    titleLabelRow.className = 'preflight-section-label'
    titleLabelRow.innerHTML = `<span>Title</span><span class="preflight-section-line"></span>`
    card.appendChild(titleLabelRow)

    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    const defaultTitle = `Meeting ${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
    const titleInput = document.createElement('input')
    titleInput.type = 'text'
    titleInput.className = 'preflight-title-input'
    titleInput.placeholder = 'Untitled recording'
    titleInput.value = defaultTitle
    card.appendChild(titleInput)

    const errorEl = document.createElement('div')
    errorEl.className = 'error-banner'
    errorEl.style.cssText = 'display:none;margin-top:10.5px'
    card.appendChild(errorEl)

    // Footer
    const footer = document.createElement('div')
    footer.className = 'preflight-footer'

    const footInfo = document.createElement('div')
    footInfo.className = 'preflight-footer-info'
    footInfo.innerHTML = `
      <span class="sb-footer-dot"></span>
      <span>On-device · private</span>
      <span style="margin:0 4px;opacity:0.4">·</span>
      <span>Auto-saves to workspace</span>`

    const discardBtn = document.createElement('button')
    discardBtn.className = 'st-btn st-btn--ghost'
    discardBtn.style.cssText = 'height:36px;font-size:14px'
    discardBtn.textContent = 'Discard'
    discardBtn.addEventListener('click', () => app.showImport())

    const transcribeBtn = document.createElement('button')
    transcribeBtn.className = 'st-btn st-btn--primary'
    transcribeBtn.style.cssText = 'height:36px;padding:0 19px;font-size:14px;gap:8px'
    transcribeBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M1 6l3.5 3.5L11 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>Transcribe`
    transcribeBtn.addEventListener('click', () => {
      transcribeBtn.disabled = true
      discardBtn.disabled = true
      errorEl.style.display = 'none'
      const body = {
        audio_path: filePath,
        whisper_model: appSettings.transcribeModel,
        language: appSettings.transcribeLang === 'auto' ? null : appSettings.transcribeLang,
      }
      fetch(`${API_BASE}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(r => { if (!r.ok) throw new Error(`Server error ${r.status}`); return r.json() })
        .then(({ job_id }) => app.showProgress(job_id, body))
        .catch(err => {
          errorEl.textContent = `Could not start transcription: ${err.message}`
          errorEl.style.display = 'block'
          transcribeBtn.disabled = false
          discardBtn.disabled = false
        })
    })

    footer.appendChild(footInfo)
    footer.appendChild(discardBtn)
    footer.appendChild(transcribeBtn)
    card.appendChild(footer)
  }

  showReady()
  return root
}
