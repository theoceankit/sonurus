// The UI draws its own title bar: no system frame, the system's window buttons
// over the page. Where they stand differs between systems and desktops, so the
// page asks for it through env(titlebar-area-*).
//
// The strip and the window behind the page take the title bar's colours of the
// theme the window is in (nativeTheme.shouldUseDarkColors). Values of tokens.css,
// a build test keeps them in step: --color-bg-sunken, --color-text-primary and the
// alpha of --color-scrim.
const THEMES = {
  light: { bgSunken: '#F6F6F9', textPrimary: '#242426', scrimAlpha: 0.4 },
  dark: { bgSunken: '#101012', textPrimary: '#F6F6F9', scrimAlpha: 0.6 },
}
const TITLEBAR_HEIGHT = 40

const themeOf = dark => (dark ? THEMES.dark : THEMES.light)

function windowChrome(dark = false) {
  const { bgSunken, textPrimary } = themeOf(dark)
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: bgSunken, symbolColor: textPrimary, height: TITLEBAR_HEIGHT },
    backgroundColor: bgSunken,
  }
}

// What settings.json may hold as the theme; anything else follows the system.
const THEME_SOURCES = ['system', 'light', 'dark']
const themeSource = value => (THEME_SOURCES.includes(value) ? value : 'system')

// A modal's scrim does not reach the strip of the window buttons, which the system
// draws over the page. While a modal is open the strip takes the colours of the page
// under the scrim, with the scrim's timing (--color-scrim, the presence animation of
// motion.module.css). macOS draws its own buttons and has no such strip to colour.
const DIM = {
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
function dimmedOverlay(amount, dark = false) {
  const { bgSunken, textPrimary, scrimAlpha } = themeOf(dark)
  const alpha = scrimAlpha * amount
  return { color: darken(bgSunken, alpha), symbolColor: darken(textPrimary, alpha) }
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
// each frame counts time from when the scrim started. A theme that changes repaints
// the strip where it is (refresh).
function overlayDimmer(apply, { now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, isDark = () => false } = {}) {
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
      apply(dimmedOverlay(amount, isDark()))
      timer = progress < 1 ? setTimer(frame, FRAME_MS) : null
    }
    frame()
  }

  function refresh() {
    if (timer === null) apply(dimmedOverlay(amount, isDark()))
  }

  function stop() {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  return { set, refresh, stop }
}

module.exports = { windowChrome, themeSource, dimmedOverlay, cubicBezier, overlayDimmer, DIM, THEMES }
