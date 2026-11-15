import type { ThemeSource } from './electron-api'

// The theme of the window. In Electron the main process sets nativeTheme.themeSource
// (electron/main.js), and that sets prefers-color-scheme in the page: the page only
// follows the media query onto data-theme of the root, which picks the token values
// (tokens.css). System follows the OS as it changes, with nothing more to do here.
// Without Electron (the UI on fixtures in a browser) nothing sets themeSource, so a
// choice of Light or Dark is kept here and wins over the media query.

const DARK = '(prefers-color-scheme: dark)'

let forced: 'light' | 'dark' | null = null
let media: MediaQueryList | null = null

const bridge = () => (typeof window === 'undefined' ? undefined : window.electronAPI)

function apply() {
  const dark = forced ? forced === 'dark' : Boolean(media?.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

// Puts data-theme on the root and keeps it there as the theme changes. Runs before
// the first render, so the page never draws in the other theme first.
export function followTheme() {
  if (typeof document === 'undefined') return
  if (!media && typeof window.matchMedia === 'function') {
    media = window.matchMedia(DARK)
    media.addEventListener('change', apply)
  }
  apply()
}

// The Theme setting changed: the window takes it at once.
export function setThemeSource(source: ThemeSource): Promise<void> {
  const api = bridge()
  forced = api || source === 'system' ? null : source
  apply()
  return api?.setTheme(source).catch(() => {}) ?? Promise.resolve()
}

// Tests start from no theme and no listener.
export function resetTheme() {
  media?.removeEventListener('change', apply)
  media = null
  forced = null
  delete document.documentElement.dataset.theme
}
