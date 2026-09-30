// ── Player bar ─────────────────────────────────────────────────────────────────
function makePlayerBar(transcript, audio, signal, knownSpeakers = []) {
  const segs = transcript.segments

  const bar = document.createElement('div')
  bar.className = 'player-bar'

  // ── Icons ──────────────────────────────────────────────────────────────────
  const I_PREV_SPK = icon('prev-speaker', 17)
  const I_PREV_15  = icon('rewind', 17)
  const I_PLAY     = icon('play', 17)
  const I_PAUSE    = icon('pause', 17)
  const I_NEXT_15  = icon('forward', 17)
  const I_NEXT_SPK = icon('next-speaker', 17)
  const I_VOLUME   = icon('volume', 16)

  // The audio element outlives the player bar (rebuilt after every edit), so every
  // control starts from its current state, not defaults: its events do not fire again.
  const clock = playerClock(audio)

  function makeBtn(html, cls = '') {
    const btn = document.createElement('button')
    btn.className = 'player-btn' + (cls ? ' ' + cls : '')
    btn.innerHTML = html
    return btn
  }

  const prevSpkBtn = makeBtn(I_PREV_SPK)
  const prev15Btn  = makeBtn(I_PREV_15)
  const playBtn    = makeBtn(clock.playing ? I_PAUSE : I_PLAY, 'player-btn--play')
  const next15Btn  = makeBtn(I_NEXT_15)
  const nextSpkBtn = makeBtn(I_NEXT_SPK)

  const controls = document.createElement('div')
  controls.className = 'player-controls'
  ;[prevSpkBtn, prev15Btn, playBtn, next15Btn, nextSpkBtn].forEach(b => controls.appendChild(b))

  // ── Elapsed ────────────────────────────────────────────────────────────────
  const elapsed = document.createElement('span')
  elapsed.className = 'player-time'
  elapsed.textContent = clock.elapsed

  // ── Waveform ───────────────────────────────────────────────────────────────
  const _km = buildKnownMap(knownSpeakers)
  const waveform = buildWaveform(segs, audio, signal, _km)

  // ── Total ─────────────────────────────────────────────────────────────────
  const total = document.createElement('span')
  total.className = 'player-time'
  total.style.textAlign = 'right'
  total.textContent = clock.total

  // ── Speed ─────────────────────────────────────────────────────────────────
  const SPEEDS = [1, 1.2, 1.5, 2]
  let speedIdx = Math.max(0, SPEEDS.indexOf(audio.playbackRate))
  const speedBtn = document.createElement('button')
  speedBtn.className = 'player-speed'
  speedBtn.textContent = SPEEDS[speedIdx] + '×'
  speedBtn.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length
    audio.playbackRate = SPEEDS[speedIdx]
    speedBtn.textContent = SPEEDS[speedIdx] + '×'
  })

  // ── Volume ────────────────────────────────────────────────────────────────
  const volWrap = document.createElement('div')
  volWrap.className = 'vol-wrap'

  const volBtn = makeBtn(I_VOLUME)
  volBtn.style.opacity = audio.volume === 0 ? '0.4' : '1'

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
