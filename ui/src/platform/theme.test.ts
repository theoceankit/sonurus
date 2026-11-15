import { afterEach, expect, test, vi } from 'vitest'
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
