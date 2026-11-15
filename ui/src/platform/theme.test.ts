import { afterEach, expect, test, vi } from 'vitest'
import base from '../styles/base.css?raw'
import { createMockElectronAPI } from './electron-api-mock'
import { followTheme, resetTheme, setThemeSource } from './theme'

// prefers-color-scheme as the OS, or Electron's nativeTheme.themeSource, sets it.
function stubScheme(dark: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches: dark,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }
  vi.stubGlobal('matchMedia', (query: string) => {
    expect(query).toBe('(prefers-color-scheme: dark)')
    return media
  })
  return {
    change(next: boolean) {
      media.matches = next
      listeners.forEach(listener => listener())
    },
    listeners: () => listeners.size,
  }
}

const theme = () => document.documentElement.dataset.theme

afterEach(() => {
  resetTheme()
  vi.unstubAllGlobals()
})

test('the root takes the theme of the media query before anything draws', () => {
  stubScheme(true)
  followTheme()
  expect(theme()).toBe('dark')
})

test('the root follows the media query as it changes, with one listener however often it starts', () => {
  const scheme = stubScheme(false)
  followTheme()
  followTheme()
  expect(theme()).toBe('light')
  expect(scheme.listeners()).toBe(1)
  scheme.change(true)
  expect(theme()).toBe('dark')
  scheme.change(false)
  expect(theme()).toBe('light')
})

test('without matchMedia the theme is light', () => {
  vi.stubGlobal('matchMedia', undefined)
  followTheme()
  expect(theme()).toBe('light')
})

test('in Electron a choice goes to the main process, and the media query it sets decides', async () => {
  const scheme = stubScheme(false)
  const setTheme = vi.fn(async () => {})
  vi.stubGlobal('electronAPI', createMockElectronAPI({ setTheme }))
  followTheme()
  await setThemeSource('dark')
  expect(setTheme).toHaveBeenCalledWith('dark')
  // nativeTheme.themeSource = 'dark' turns the media query dark.
  expect(theme()).toBe('light')
  scheme.change(true)
  expect(theme()).toBe('dark')
})

test('a main process that does not answer leaves the page as it is', async () => {
  stubScheme(false)
  vi.stubGlobal('electronAPI', createMockElectronAPI({ setTheme: async () => { throw new Error('gone') } }))
  followTheme()
  await expect(setThemeSource('dark')).resolves.toBeUndefined()
  expect(theme()).toBe('light')
})

test('without Electron Light and Dark win over the media query, and System gives it back', async () => {
  const scheme = stubScheme(true)
  vi.stubGlobal('electronAPI', undefined)
  followTheme()
  await setThemeSource('light')
  expect(theme()).toBe('light')
  scheme.change(true)
  expect(theme()).toBe('light')
  await setThemeSource('system')
  expect(theme()).toBe('dark')
})

test('until the root has a theme the page draws no background, so the window\'s own shows', () => {
  // The window's background is in the theme already (electron/window-chrome.js); the
  // light values the page has before followTheme() would flash for a frame or two.
  expect(base).toMatch(/:root:not\(\[data-theme\]\) body \{\s*background: none;\s*\}/)
})

// document.startViewTransition as Chromium has it: the change runs inside it.
function stubTransition() {
  const start = vi.fn((update: () => void) => { update() })
  Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true })
  return start
}

afterEach(() => {
  delete (document as { startViewTransition?: unknown }).startViewTransition
})

test('a change of theme cross-fades the page, the first theme does not', () => {
  const scheme = stubScheme(false)
  const start = stubTransition()
  followTheme()
  expect(start).not.toHaveBeenCalled()
  scheme.change(true)
  expect(start).toHaveBeenCalledTimes(1)
  expect(theme()).toBe('dark')
})

test('a media query that fires without a change of theme starts no cross-fade', () => {
  const scheme = stubScheme(true)
  const start = stubTransition()
  followTheme()
  scheme.change(true)
  expect(start).not.toHaveBeenCalled()
})

test('without View Transitions the theme changes at once', () => {
  const scheme = stubScheme(false)
  followTheme()
  scheme.change(true)
  expect(theme()).toBe('dark')
})

test('the cross-fade has the timing of the motion tokens', () => {
  expect(base).toMatch(/::view-transition-old\(root\),\s*::view-transition-new\(root\) \{\s*animation-duration: var\(--duration-move\);\s*animation-timing-function: var\(--ease-standard\);/)
})
