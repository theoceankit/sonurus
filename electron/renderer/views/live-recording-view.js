function renderLiveRecordingView(settings = {}) {
  const {
    audioSource    = appSettings.recordingAudioSource  || 'both',
    micDeviceId    = appSettings.recordingMicDevice    || null,
    systemDeviceId = appSettings.recordingSystemDevice || null,
    title: sessionTitle = '',
    model          = appSettings.transcribeModel       || 'large-v3',
    language       = appSettings.transcribeLang        || 'auto',
  } = settings

  let recorder      = null
  let audioCtx      = null
  let micStream     = null
  let sysStream     = null
  let captureJobId  = null   // backend-managed system audio job (macOS/Linux)
  let chunks        = []
  let elapsed       = 0
  let timerInterval = null
  let animFrameId   = null
  let micAnalyser   = null
  let sysAnalyser   = null

  const root = document.createElement('div')
  root.className = 'import-view'

  // ── Helpers ────────────────────────────────────────────────────────────────

  function fmtElapsed(s) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  function getLevel(analyser) {
    if (!analyser) return 0
    analyser._buf ||= new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(analyser._buf)
    return Math.min(1, analyser._buf.reduce((a, b) => a + b, 0) / analyser._buf.length / 64)
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

  // ── Starting (brief permission-request state) ──────────────────────────────

  function showStarting() {
    root.innerHTML = ''
    const wrap = document.createElement('div')
    wrap.className = 'progress-view'
    wrap.innerHTML = `
      <div class="progress-view__title">Starting recording…</div>
      <div class="progress-view__step">Requesting audio permissions</div>`
    root.appendChild(wrap)
  }

  // ── Start recording ────────────────────────────────────────────────────────

  async function startRecording() {
    showStarting()

    try {
      const platform = await window.electronAPI.getPlatform()

      // Mic stream
      if (audioSource !== 'system') {
        const constraint = micDeviceId
          ? { deviceId: { exact: micDeviceId } }
          : true
        micStream = await navigator.mediaDevices.getUserMedia({ audio: constraint })
      }

      // System audio stream
      if (audioSource !== 'mic') {
        const isBackendCapture = platform !== 'win32'
          && systemDeviceId
          && systemDeviceId !== '__default__'
          && systemDeviceId !== '__desktop__'

        if (isBackendCapture) {
          // macOS (ScreenCaptureKit) or Linux (ffmpeg + PulseAudio monitor)
          const resp = await fetch(`${API_BASE}/audio/capture/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_id: systemDeviceId }),
          })
          if (!resp.ok) {
            const data = await resp.json().catch(() => ({}))
            const msg = data.detail || 'Failed to start system audio capture.'
            const isPermission = /permission|denied|SCStream|TCC|Screen Recording/i.test(msg)
            throw new Error(isPermission
              ? 'Screen Recording access is required. Open System Settings → Privacy & Security → Screen Recording and enable Sonorus, then try again.'
              : msg)
          }
          captureJobId = (await resp.json()).job_id
        } else if (systemDeviceId === '__desktop__') {
          // Windows: intercepted by setDisplayMediaRequestHandler → WASAPI loopback
          const displayStream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: { width: 1, height: 1 },
          })
          displayStream.getVideoTracks().forEach(t => { t.stop(); displayStream.removeTrack(t) })
          if (displayStream.getAudioTracks().length === 0) {
            throw new Error('System audio not captured: the screen share returned no audio. Make sure "Share computer sound" is enabled when selecting a screen.')
          }
          sysStream = displayStream
        }
      }

      if (!micStream && !sysStream && !captureJobId) {
        throw new Error('No audio source available. Check device permissions.')
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

      // Only start a recorder when there are browser-managed streams.
      // captureJobId-only (system audio, no mic): no recorder needed.
      if (micStream || sysStream) {
        chunks = []
        recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' })
        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
        recorder.start(1000)
      }

      showRecording()
    } catch (err) {
      stopStreams()
      if (captureJobId) {
        fetch(`${API_BASE}/audio/capture/stop/${captureJobId}`, { method: 'POST' }).catch(() => {})
        captureJobId = null
      }
      showError(err.message)
    }
  }

  // ── Error state ────────────────────────────────────────────────────────────

  function showError(message) {
    root.innerHTML = ''
    const wrap = document.createElement('div')
    wrap.className = 'progress-view'
    const banner = document.createElement('div')
    banner.className = 'error-banner'
    banner.style.display = 'block'
    banner.textContent = message
    const backBtn = document.createElement('button')
    backBtn.className = 'progress-view__cancel'
    backBtn.textContent = '← Back'
    backBtn.addEventListener('click', () => app.showHome())
    wrap.appendChild(banner)
    wrap.appendChild(backBtn)
    root.appendChild(wrap)
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
      const elapsed_ = elapsed

      if (captureJobId && recorder) {
        // Backend system audio + browser mic: save mic first, then merge server-side
        recorder.onstop = async () => {
          try {
            const blob = new Blob(chunks, { type: 'audio/webm;codecs=opus' })
            const micPath = await window.electronAPI.saveRecording(await blob.arrayBuffer(), 'webm')
            micStream?.getTracks().forEach(t => t.stop())
            audioCtx?.close()
            micStream = audioCtx = micAnalyser = null
            const r = await fetch(`${API_BASE}/audio/capture/stop/${captureJobId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mic_path: micPath }),
            })
            captureJobId = null
            if (!r.ok) {
              const data = await r.json().catch(() => ({}))
              throw new Error(data.detail || 'Failed to stop audio capture.')
            }
            showReview((await r.json()).file_path, elapsed_)
          } catch (err) {
            captureJobId = null
            showError(err.message)
          }
        }
        recorder.stop()
      } else if (captureJobId) {
        // Backend system audio only — no browser recorder
        ;(async () => {
          try {
            const r = await fetch(`${API_BASE}/audio/capture/stop/${captureJobId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            })
            captureJobId = null
            if (!r.ok) {
              const data = await r.json().catch(() => ({}))
              throw new Error(data.detail || 'Failed to stop audio capture.')
            }
            showReview((await r.json()).file_path, elapsed_)
          } catch (err) {
            captureJobId = null
            showError(err.message)
          }
        })()
      } else {
        // Browser-only: mic alone, or Windows system audio mixed in browser
        if (!recorder) { showError('Recording state is inconsistent'); return }
        recorder.onstop = () => finishRecording(elapsed_)
        recorder.stop()
      }
    })
    card.appendChild(stopBtn)

    // Tick timer
    timerInterval = setInterval(() => {
      elapsed++
      timerEl.textContent = fmtElapsed(elapsed)
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
      backBtn.addEventListener('click', () => app.showHome())
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
    const defaultTitle = sessionTitle ||
      `Meeting ${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
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
    discardBtn.addEventListener('click', () => app.showHome())

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
        whisper_model: model,
        language: language === 'auto' ? null : language,
        title: titleInput.value.trim() || null,
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

  startRecording()
  return root
}
