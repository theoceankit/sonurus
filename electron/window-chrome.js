// The UI draws its own title bar: no system frame, the system's window buttons
// over the page. Where they stand differs between systems and desktops, so the
// page asks for it through env(titlebar-area-*).
//
// Values of tokens.css in the light theme, a build test keeps them in step. The
// dark theme is not enabled yet, so the window buttons have these colours only.
const BG_SUNKEN = '#F6F6F9'
const TEXT_PRIMARY = '#242426'
const TITLEBAR_HEIGHT = 40

function windowChrome() {
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG_SUNKEN, symbolColor: TEXT_PRIMARY, height: TITLEBAR_HEIGHT },
    backgroundColor: BG_SUNKEN,
  }
}

// A modal's scrim does not reach the strip of the window buttons, which the system
// draws over the page. While a modal is open the strip takes the colours of the page
// under the scrim, with the scrim's timing (--color-scrim, the presence animation of
// motion.module.css). macOS draws its own buttons and has no such strip to colour.
const DIM = {
  scrimAlpha: 0.4,
  inMs: 200,
  outMs: 150,
  easeIn: [0.16, 1, 0.3, 1],
  easeOut: [0.4, 0, 1, 1],
}
const FRAME_MS = 16
// The longest the page may have been dimming before the strip heard of it.
const MAX_LAG_MS = 50

const hex = value => value.toString(16).padStart(2, '0').toUpperCase()

function darken(color, alpha) {
  const channels = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))
  return `#${channels.map(c => hex(Math.round(c * (1 - alpha)))).join('')}`
}

// amount: 0 for no modal, 1 for the scrim at full strength.
function dimmedOverlay(amount) {
  const alpha = DIM.scrimAlpha * amount
  return { color: darken(BG_SUNKEN, alpha), symbolColor: darken(TEXT_PRIMARY, alpha) }
}

// The CSS cubic-bezier(x1, y1, x2, y2): progress in time → progress of the value.
function cubicBezier([x1, y1, x2, y2]) {
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3
  const slope = (a, b, t) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t ** 2
  return x => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const d = slope(x1, x2, t)
      if (Math.abs(d) < 1e-6) break
      t = Math.min(1, Math.max(0, t - (at(x1, x2, t) - x) / d))
    }
    return at(y1, y2, t)
  }
}

// Moves the strip between plain and dimmed. A change halfway starts from where the
// strip is, so it never jumps. The page's scrim starts before the strip hears of it:
// each frame counts time from when the scrim started.
function overlayDimmer(apply, { now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let amount = 0
  let target = 0
  let timer = null

  function set(dimmed, startedAt) {
    const next = dimmed ? 1 : 0
    if (next === target) return
    target = next
    if (timer !== null) clearTimer(timer)
    timer = null
    const from = amount
    const heard = now()
    const start = Number.isFinite(startedAt) ? Math.min(heard, Math.max(startedAt, heard - MAX_LAG_MS)) : heard
    const duration = dimmed ? DIM.inMs : DIM.outMs
    const ease = cubicBezier(dimmed ? DIM.easeIn : DIM.easeOut)
    const frame = () => {
      const progress = Math.min(1, (now() - start) / duration)
      amount = from + (target - from) * ease(progress)
      apply(dimmedOverlay(amount))
      timer = progress < 1 ? setTimer(frame, FRAME_MS) : null
    }
    frame()
  }

  function stop() {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  return { set, stop }
}

module.exports = { windowChrome, dimmedOverlay, cubicBezier, overlayDimmer, DIM }
