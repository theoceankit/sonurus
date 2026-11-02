import { expect, test } from 'vitest'
import { createMockElectronAPI } from './electron-api-mock'

test('settings and the clipboard stay in memory, one copy per mock', async () => {
  const first = createMockElectronAPI()
  const second = createMockElectronAPI()
  const settings = await first.readSettings()
  await first.writeSettings({ ...settings, scale: 125 })
  await first.writeClipboard('copied')
  expect((await first.readSettings()).scale).toBe(125)
  expect((await second.readSettings()).scale).toBe(100)
  expect(first.clipboard()).toBe('copied')
})

test('a story can change one call', async () => {
  const api = createMockElectronAPI({ getPlatform: async () => 'darwin' })
  expect(await api.getPlatform()).toBe('darwin')
})
