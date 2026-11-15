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

function windowChrome(dark = false) {
  const { bgSunken, textPrimary } = dark ? THEMES.dark : THEMES.light
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
// A change of theme cross-fades the page (ui/src/platform/theme.ts); the strip moves
// to the new colours on the same timing: --duration-move, --ease-standard.
const THEME_FADE = {
  ms: 250,
  ease: [0.2, 0, 0, 1],
}
const FRAME_MS = 16
// The longest the page may have been dimming before the strip heard of it.
const MAX_LAG_MS = 50

const hex = value => value.toString(16).padStart(2, '0').toUpperCase()

const channels = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))
const lerp = (a, b, t) => a + (b - a) * t

// A colour between the light and the dark one, darkened by a scrim of that alpha.
function blend(light, dark, darkness, alpha) {
  const [l, d] = [channels(light), channels(dark)]
  return `#${l.map((c, i) => hex(Math.round(lerp(c, d[i], darkness) * (1 - alpha)))).join('')}`
}

// amount: 0 for no modal, 1 for the scrim at full strength. dark: false or 0 for the
// light theme, true or 1 for the dark one, and between them while the theme changes.
function dimmedOverlay(amount, dark = false) {
  const darkness = Number(dark)
  const alpha = lerp(THEMES.light.scrimAlpha, THEMES.dark.scrimAlpha, darkness) * amount
  return {
    color: blend(THEMES.light.bgSunken, THEMES.dark.bgSunken, darkness, alpha),
    symbolColor: blend(THEMES.light.textPrimary, THEMES.dark.textPrimary, darkness, alpha),
  }
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

// Moves the strip between plain and dimmed, and between the themes. A change halfway
// starts from where the strip is, so it never jumps. The page's scrim starts before
// the strip hears of it: each frame counts time from when the scrim started. The two
// move apart, a modal opening while the theme changes, on one timer.
function overlayDimmer(apply, { now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, dark = false } = {}) {
  const track = value => ({ value, from: value, target: value, start: 0, duration: 0, ease: null })
  const dim = track(0)
  const theme = track(dark ? 1 : 0)
  let timer = null

  function frame() {
    let moving = false
    for (const t of [dim, theme]) {
      if (!t.ease) continue
      const progress = Math.min(1, (now() - t.start) / t.duration)
      t.value = t.from + (t.target - t.from) * t.ease(progress)
      if (progress < 1) moving = true
      else t.ease = null
    }
    apply(dimmedOverlay(dim.value, theme.value))
    timer = moving ? setTimer(frame, FRAME_MS) : null
  }

  function move(t, target, start, duration, curve) {
    if (target === t.target) return
    Object.assign(t, { target, from: t.value, start, duration, ease: cubicBezier(curve) })
    if (timer !== null) clearTimer(timer)
    timer = null
    frame()
  }

  function set(dimmed, startedAt) {
    const heard = now()
    const start = Number.isFinite(startedAt) ? Math.min(heard, Math.max(startedAt, heard - MAX_LAG_MS)) : heard
    move(dim, dimmed ? 1 : 0, start, dimmed ? DIM.inMs : DIM.outMs, dimmed ? DIM.easeIn : DIM.easeOut)
  }

  function setTheme(isDark) {
    move(theme, isDark ? 1 : 0, now(), THEME_FADE.ms, THEME_FADE.ease)
  }

  function stop() {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  return { set, setTheme, stop }
}

module.exports = { windowChrome, themeSource, dimmedOverlay, cubicBezier, overlayDimmer, DIM, THEME_FADE, THEMES }
