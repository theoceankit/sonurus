import { expect, test, vi } from 'vitest'
import { createMockElectronAPI } from './electron-api-mock'
import { applySavedScale, createSettingsStore, DEFAULT_SETTINGS, settingsStore } from './settings'

test('reads the file once and keeps what it holds', async () => {
  const bridge = createMockElectronAPI()
  await bridge.writeSettings({ ...DEFAULT_SETTINGS, scale: 125 })
  const read = vi.spyOn(bridge, 'readSettings')
  const store = createSettingsStore(bridge)
  expect(store.current()).toBeNull()
  expect((await store.read()).scale).toBe(125)
  await store.read()
  expect(read).toHaveBeenCalledTimes(1)
  expect(store.current()?.scale).toBe(125)
})

test('a file without a setting gets its default', async () => {
  const bridge = createMockElectronAPI({ readSettings: async () => ({ scale: 90 }) as never })
  expect(await createSettingsStore(bridge).read()).toEqual({ ...DEFAULT_SETTINGS, scale: 90 })
})

test('a file that cannot be read gives the defaults', async () => {
  const bridge = createMockElectronAPI({ readSettings: async () => { throw new Error('broken') } })
  expect(await createSettingsStore(bridge).read()).toEqual(DEFAULT_SETTINGS)
})

test('a change shows at once and goes on top of the file as it is then', async () => {
  const bridge = createMockElectronAPI()
  const store = createSettingsStore(bridge)
  await store.read()
  // Written by the old UI or another window in the meantime.
  await bridge.writeSettings({ ...DEFAULT_SETTINGS, hfToken: 'hf_other' })
  const listener = vi.fn()
  store.subscribe(listener)
  const written = store.patch({ scale: 150 })
  expect(store.current()?.scale).toBe(150)
  expect(listener).toHaveBeenCalled()
  await written
  expect(await bridge.readSettings()).toMatchObject({ scale: 150, hfToken: 'hf_other' })
})

test('changes are written one after another, none lost', async () => {
  const bridge = createMockElectronAPI()
  const store = createSettingsStore(bridge)
  await store.read()
  void store.patch({ scale: 75 })
  void store.patch({ transcribeLang: 'de' })
  await store.patch({ recentTranscriptIds: [3, 1] })
  expect(await bridge.readSettings()).toMatchObject({ scale: 75, transcribeLang: 'de', recentTranscriptIds: [3, 1] })
})

test('a change made before the file was read stays on top of it', async () => {
  const bridge = createMockElectronAPI()
  await bridge.writeSettings({ ...DEFAULT_SETTINGS, scale: 125, transcribeLang: 'fr' })
  const store = createSettingsStore(bridge)
  const written = store.patch({ transcribeLang: 'de' })
  expect((await store.read())).toMatchObject({ scale: 125, transcribeLang: 'de' })
  await written
  expect(await bridge.readSettings()).toMatchObject({ scale: 125, transcribeLang: 'de' })
})

test('without Electron the settings are the defaults, kept in memory', async () => {
  const store = createSettingsStore(undefined)
  expect(store.current()).toEqual(DEFAULT_SETTINGS)
  await store.patch({ scale: 80 })
  expect((await store.read()).scale).toBe(80)
})

test('one store per bridge', () => {
  const bridge = createMockElectronAPI()
  vi.stubGlobal('electronAPI', bridge)
  const first = settingsStore()
  expect(settingsStore()).toBe(first)
  vi.stubGlobal('electronAPI', createMockElectronAPI())
  expect(settingsStore()).not.toBe(first)
  vi.unstubAllGlobals()
})

test('the saved scale is applied on start', async () => {
  const setZoom = vi.fn(async () => {})
  const bridge = createMockElectronAPI({ setZoom })
  await bridge.writeSettings({ ...DEFAULT_SETTINGS, scale: 150 })
  vi.stubGlobal('electronAPI', bridge)
  await applySavedScale()
  expect(setZoom).toHaveBeenCalledWith(1.5)
  vi.unstubAllGlobals()
})
