import { afterEach, expect, test, vi } from 'vitest'
import { createMockElectronAPI } from './electron-api-mock'
import { readTranscribeSettings, transcribeSettings } from './transcribe-defaults'

afterEach(() => vi.unstubAllGlobals())

test('the saved model, its history and the language go as they are', () => {
  expect(transcribeSettings({ transcribeModel: 'large-v3', transcribeModelHistory: ['tiny', 'large-v3'], transcribeLang: 'de' }))
    .toEqual({ transcribeModel: 'large-v3', transcribeModelHistory: ['tiny', 'large-v3'], transcribeLang: 'de' })
})

test('nothing saved is no model, no history and a detected language', () => {
  const none = { transcribeModel: null, transcribeModelHistory: [], transcribeLang: 'auto' }
  expect(transcribeSettings({ transcribeModel: null, transcribeLang: '' })).toEqual(none)
  expect(transcribeSettings({})).toEqual(none)
  expect(transcribeSettings(undefined)).toEqual(none)
})

test('reads the settings of Electron, and without it the same as nothing saved', async () => {
  expect(await readTranscribeSettings()).toEqual({ transcribeModel: null, transcribeModelHistory: [], transcribeLang: 'auto' })
  const bridge = createMockElectronAPI()
  await bridge.writeSettings({ ...await bridge.readSettings(), transcribeModel: 'small', transcribeLang: 'ru' })
  vi.stubGlobal('electronAPI', bridge)
  expect(await readTranscribeSettings()).toMatchObject({ transcribeModel: 'small', transcribeLang: 'ru' })
})
