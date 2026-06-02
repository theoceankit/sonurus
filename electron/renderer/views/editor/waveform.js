// ── Waveform ───────────────────────────────────────────────────────────────────
function buildWaveform(segs, audio, signal, knownMap = {}) {
  const BARS = 120

  const heights = (() => {
    const arr = []; let seed = 11
    for (let i = 0; i < BARS; i++) {
      seed = (seed * 9301 + 49297) % 233280
      const r = seed / 233280
      const env = 0.45 + 0.55 * Math.abs(Math.sin(i * 0.13)) * (0.7 + 0.3 * Math.cos(i * 0.05))
      arr.push(Math.max(0.10, Math.min(1, env * (0.55 + 0.55 * r))))
    }
    return arr
  })()

  const DEFAULT_BAR_COLOR = 'rgba(0,0,0,0.20)'

  const wrap = document.createElement('div')
  wrap.className = 'waveform'

  // Canvas for crisp, gap-free rendering with pill-shaped bars
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;'
  wrap.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  const colors = new Array(BARS).fill(null)
  let hoveredSeg = null

  function render() {
    const W = canvas.width, H = canvas.height
    if (!W || !H) return
    ctx.clearRect(0, 0, W, H)

    const dpr = window.devicePixelRatio || 1
    const filled = audio.duration ? (audio.currentTime / audio.duration) * BARS : -1
    const slotW = W / BARS
    const gap = dpr                        // 1 CSS px gap between bars
    const bw = Math.max(1, slotW - gap)
    const r = bw / 2                       // pill: radius = half width

    for (let i = 0; i < BARS; i++) {
      const h = Math.max(bw, heights[i] * H * 0.84)
      const x = i * slotW + gap / 2
      const y = (H - h) / 2
      const t = (i + 0.5) / BARS * (audio.duration || 1)
      const inHovered = hoveredSeg && t >= hoveredSeg.start && t < hoveredSeg.end
      const isActive = i <= filled || inHovered

      ctx.globalAlpha = isActive ? 1.0 : 0.28
      ctx.fillStyle = colors[i] || DEFAULT_BAR_COLOR
      ctx.beginPath()
      ctx.roundRect(x, y, bw, h, r)
      ctx.fill()
    }
    ctx.globalAlpha = 1.0
  }

  const ro = new ResizeObserver(() => {
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(wrap.clientWidth * dpr)
    canvas.height = Math.round(wrap.clientHeight * dpr)
    render()
  })
  ro.observe(wrap)
  signal.addEventListener('abort', () => ro.disconnect())

  function colorAt(i) {
    if (!audio.duration) return null
    const t = (i + 0.5) / BARS * audio.duration
    const seg = segs.find(s => t >= s.start && t < s.end)
    if (!seg) return null
    const spkId = effectiveSpeaker(seg)
    return isUnrecognized(spkId, knownMap) ? null : speakerPalette(spkId).color
  }

  function updateColors() {
    for (let i = 0; i < BARS; i++) colors[i] = colorAt(i)
    render()
  }

  audio.addEventListener('loadedmetadata', () => { updateColors(); render() }, { signal })
  audio.addEventListener('timeupdate', render, { signal })

  // Hover scrubber
  const scrubLine = document.createElement('div')
  scrubLine.className = 'waveform-scrub'
  wrap.appendChild(scrubLine)

  const scrubTip = document.createElement('div')
  scrubTip.className = 'waveform-tip'
  const tipTime = document.createElement('span')
  tipTime.className = 'waveform-tip-time'
  const tipName = document.createElement('span')
  tipName.className = 'waveform-tip-name'
  scrubTip.appendChild(tipTime)
  scrubTip.appendChild(tipName)
  wrap.appendChild(scrubTip)

  // Seek interaction
  let dragging = false
  function seekAt(e) {
    const rect = wrap.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    if (audio.duration) audio.currentTime = pct * audio.duration
  }
  function moveScrubber(e) {
    const rect = wrap.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const t = audio.duration ? (x / rect.width) * audio.duration : 0

    scrubLine.style.left = x + 'px'
    scrubLine.style.display = 'block'

    const seg = segs.find(s => t >= s.start && t < s.end) || null
    tipTime.textContent = fmtTime(t)

    if (seg !== hoveredSeg) {
      hoveredSeg = seg
      render()
    }

    if (seg) {
      const spkId = effectiveSpeaker(seg)
      tipName.textContent = knownMap[spkId] || 'Unknown speaker'
      tipName.style.display = 'block'
    } else {
      tipName.style.display = 'none'
    }

    scrubTip.style.left = x + 'px'
    scrubTip.style.display = 'block'
  }
  wrap.addEventListener('mousedown', e => { dragging = true; seekAt(e) })
  wrap.addEventListener('mousemove', e => { moveScrubber(e); if (dragging) seekAt(e) })
  document.addEventListener('mouseup', () => { dragging = false }, { signal })
  wrap.addEventListener('mouseleave', () => {
    if (!dragging) {
      scrubLine.style.display = 'none'
      scrubTip.style.display = 'none'
      hoveredSeg = null
      render()
    }
  })

  return wrap
}
