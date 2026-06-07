// ── Player bar ─────────────────────────────────────────────────────────────────
function makePlayerBar(transcript, audio, signal, knownSpeakers = []) {
  const segs = transcript.segments

  const bar = document.createElement('div')
  bar.className = 'player-bar'

  // ── Icons ──────────────────────────────────────────────────────────────────
  const I_PREV_SPK = `<svg width="15" height="13" viewBox="0 0 15 13" fill="none">
    <rect x="2" y="3" width="1.4" height="7" rx="0.4" fill="currentColor"/>
    <path d="M11.5 3L5 6.5L11.5 10V3z" fill="currentColor"/>
  </svg>`
  const I_PREV_15  = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M8 3.5L4.5 7l3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M5 7h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`
  const I_PLAY    = `<svg width="10" height="11" viewBox="0 0 10 12" fill="none" style="margin-left:1px">
    <path d="M1 1l8 5-8 5V1z" fill="currentColor"/>
  </svg>`
  const I_PAUSE   = `<svg width="10" height="11" viewBox="0 0 11 12" fill="none">
    <rect x="1" y="1" width="3" height="10" rx="0.7" fill="currentColor"/>
    <rect x="7" y="1" width="3" height="10" rx="0.7" fill="currentColor"/>
  </svg>`
  const I_NEXT_15  = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M6 3.5L9.5 7 6 10.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M3 7h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`
  const I_NEXT_SPK = `<svg width="15" height="13" viewBox="0 0 15 13" fill="none">
    <path d="M3.5 3L10 6.5L3.5 10V3z" fill="currentColor"/>
    <rect x="11.6" y="3" width="1.4" height="7" rx="0.4" fill="currentColor"/>
  </svg>`
  const I_VOLUME  = `<svg width="14" height="13" viewBox="0 0 16 14" fill="none">
    <path d="M2 5v4h2.5L8 11.5v-9L4.5 5H2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/>
    <path d="M10.5 4.5c1 .8 1 4.2 0 5M12.5 3c2 1.5 2 7 0 8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/>
  </svg>`

  function makeBtn(html, cls = '') {
    const btn = document.createElement('button')
    btn.className = 'player-btn' + (cls ? ' ' + cls : '')
    btn.innerHTML = html
    return btn
  }

  const prevSpkBtn = makeBtn(I_PREV_SPK)
  const prev15Btn  = makeBtn(I_PREV_15)
  const playBtn    = makeBtn(I_PLAY, 'player-btn--play')
  const next15Btn  = makeBtn(I_NEXT_15)
  const nextSpkBtn = makeBtn(I_NEXT_SPK)

  const controls = document.createElement('div')
  controls.className = 'player-controls'
  ;[prevSpkBtn, prev15Btn, playBtn, next15Btn, nextSpkBtn].forEach(b => controls.appendChild(b))

  // ── Elapsed ────────────────────────────────────────────────────────────────
  const elapsed = document.createElement('span')
  elapsed.className = 'player-time'
  elapsed.textContent = '00:00'

  // ── Waveform ───────────────────────────────────────────────────────────────
  const _km = {}; knownSpeakers.forEach(s => { _km[s.id] = { name: s.name, colorIndex: s.color_index ?? 0 } })
  const waveform = buildWaveform(segs, audio, signal, _km)

  // ── Total ─────────────────────────────────────────────────────────────────
  const total = document.createElement('span')
  total.className = 'player-time'
  total.style.textAlign = 'right'
  total.textContent = '00:00'

  // ── Speed ─────────────────────────────────────────────────────────────────
  const SPEEDS = [1, 1.2, 1.5, 2]
  let speedIdx = 0
  const speedBtn = document.createElement('button')
  speedBtn.className = 'player-speed'
  speedBtn.textContent = '1×'
  speedBtn.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length
    audio.playbackRate = SPEEDS[speedIdx]
    speedBtn.textContent = SPEEDS[speedIdx] + '×'
  })

  // ── Volume ────────────────────────────────────────────────────────────────
  const volWrap = document.createElement('div')
  volWrap.className = 'vol-wrap'

  const volBtn = makeBtn(I_VOLUME)
  audio.volume = 0.8

  const volPopup = document.createElement('div')
  volPopup.className = 'vol-popup'

  const volSlider = document.createElement('input')
  volSlider.type = 'range'
  volSlider.min = '0'
  volSlider.max = '1'
  volSlider.step = '0.02'
  volSlider.value = String(audio.volume)
  volSlider.addEventListener('input', () => {
    audio.volume = parseFloat(volSlider.value)
    audio.muted = audio.volume === 0
    volBtn.style.opacity = audio.volume === 0 ? '0.4' : '1'
  })

  volPopup.appendChild(volSlider)
  volWrap.appendChild(volBtn)
  volWrap.appendChild(volPopup)

  volBtn.addEventListener('click', () => {
    volPopup.classList.toggle('vol-popup--open')
  })
  document.addEventListener('click', e => {
    if (!volWrap.contains(e.target)) volPopup.classList.remove('vol-popup--open')
  }, { signal })

  bar.appendChild(controls)
  bar.appendChild(elapsed)
  bar.appendChild(waveform)
  bar.appendChild(total)
  bar.appendChild(speedBtn)
  bar.appendChild(volWrap)

  // ── Audio event wiring ─────────────────────────────────────────────────────
  audio.addEventListener('timeupdate', () => {
    elapsed.textContent = fmtTime(audio.currentTime)
  }, { signal })

  audio.addEventListener('durationchange', () => {
    if (isFinite(audio.duration)) total.textContent = fmtTime(audio.duration)
  }, { signal })

  audio.addEventListener('play',  () => { playBtn.innerHTML = I_PAUSE }, { signal })
  audio.addEventListener('pause', () => { playBtn.innerHTML = I_PLAY  }, { signal })
  audio.addEventListener('ended', () => { playBtn.innerHTML = I_PLAY  }, { signal })

  playBtn.addEventListener('click', () => {
    audio.paused ? audio.play().catch(() => {}) : audio.pause()
  })

  prev15Btn.addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 15) })
  next15Btn.addEventListener('click', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 15) })

  // ── Speaker navigation ─────────────────────────────────────────────────────
  function spkChanges() {
    const ch = [0]
    for (let i = 1; i < segs.length; i++) {
      if (effectiveSpeaker(segs[i]) !== effectiveSpeaker(segs[i - 1])) ch.push(i)
    }
    return ch
  }
  function curBlock(ch) {
    const t = audio.currentTime
    let b = 0
    for (let j = 0; j < ch.length; j++) { if (segs[ch[j]].start <= t) b = j }
    return b
  }

  prevSpkBtn.addEventListener('click', () => {
    const ch = spkChanges(), b = curBlock(ch)
    if (b > 0) audio.currentTime = segs[ch[b - 1]].start
  })
  nextSpkBtn.addEventListener('click', () => {
    const ch = spkChanges(), b = curBlock(ch)
    if (b + 1 < ch.length) audio.currentTime = segs[ch[b + 1]].start
  })

  return bar
}
