import type { ThemeSource } from './electron-api'

// The theme of the window. In Electron the main process sets nativeTheme.themeSource
// (electron/main.js), and that sets prefers-color-scheme in the page: the page only
// follows the media query onto data-theme of the root, which picks the token values
// (tokens.css). System follows the OS as it changes, with nothing more to do here.
// Without Electron (the UI on fixtures in a browser) nothing sets themeSource, so a
// choice of Light or Dark is kept here and wins over the media query.
//
// A change after the first cross-fades the whole page from the old theme to the new
// (View Transitions; the timing is in base.css), and the main process moves the strip
// of the window buttons with it (electron/window-chrome.js).

const DARK = '(prefers-color-scheme: dark)'

let forced: 'light' | 'dark' | null = null
let media: MediaQueryList | null = null

const bridge = () => (typeof window === 'undefined' ? undefined : window.electronAPI)

function apply(fade = false) {
  const root = document.documentElement
  const theme = forced ? forced : media?.matches ? 'dark' : 'light'
  if (root.dataset.theme === theme) return
  const set = () => { root.dataset.theme = theme }
  // The first theme is there before anything draws: nothing to fade from.
  if (fade && root.dataset.theme && typeof document.startViewTransition === 'function') document.startViewTransition(set)
  else set()
}

const change = () => apply(true)

// Puts data-theme on the root and keeps it there as the theme changes. Runs before
// the first render, so the page never draws in the other theme first.
export function followTheme() {
  if (typeof document === 'undefined') return
  if (!media && typeof window.matchMedia === 'function') {
    media = window.matchMedia(DARK)
    media.addEventListener('change', change)
  }
  apply()
}

// The Theme setting changed: the window takes it at once.
export function setThemeSource(source: ThemeSource): Promise<void> {
  const api = bridge()
  forced = api || source === 'system' ? null : source
  apply(true)
  return api?.setTheme(source).catch(() => {}) ?? Promise.resolve()
}

// Tests start from no theme and no listener.
export function resetTheme() {
  media?.removeEventListener('change', change)
  media = null
  forced = null
  delete document.documentElement.dataset.theme
}
