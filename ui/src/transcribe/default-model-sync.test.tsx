import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { createFixtureClient, type FixtureOptions } from '../api/fixtures/fixture-client'
import { App } from '../App'
import { dismissAllToasts } from '../components/Toast/toast-store'
import { OverlayProvider } from '../OverlayProvider'
import type { ElectronSettings } from '../platform/electron-api'
import { createMockElectronAPI } from '../platform/electron-api-mock'
import { DEFAULT_SETTINGS } from '../platform/settings'
import { selectTranscribeModel } from '../platform/transcribe-defaults'
import { modelDownloadsFor } from './model-downloads'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

async function setup(options: FixtureOptions, saved: Partial<ElectronSettings> = {}) {
  const client = createFixtureClient({ downloadStepMs: 5, ...options })
  const bridge = createMockElectronAPI()
  await bridge.writeSettings({ ...DEFAULT_SETTINGS, ...saved })
  vi.stubGlobal('electronAPI', bridge)
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  await screen.findByRole('region', { name: 'This week' })
  return { client, bridge }
}

test('the first model downloaded becomes the default, saved and said', async () => {
  const { client, bridge } = await setup({ installedModels: ['diarize'] })
  await act(() => modelDownloadsFor(client).start('tiny'))
  expect(await screen.findByText('Whisper Tiny is now the default transcription model')).toBeTruthy()
  await waitFor(async () => expect(await bridge.readSettings()).toMatchObject({ transcribeModel: 'tiny', transcribeModelHistory: ['tiny'] }))
})

test('an installed default at start stays, with nothing said', async () => {
  const { bridge } = await setup({ installedModels: ['small', 'diarize'] }, { transcribeModel: 'small', transcribeModelHistory: ['small'] })
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(screen.queryByText(/is now the default transcription model/)).toBeNull()
  expect((await bridge.readSettings()).transcribeModel).toBe('small')
})

test('a saved default that is not there at start gives way to an installed one', async () => {
  const { bridge } = await setup({ installedModels: ['tiny', 'diarize'] }, { transcribeModel: 'large-v3', transcribeModelHistory: ['large-v3'] })
  expect(await screen.findByText('Whisper Tiny is now the default transcription model')).toBeTruthy()
  await waitFor(async () => expect(await bridge.readSettings()).toMatchObject({ transcribeModel: 'tiny', transcribeModelHistory: ['large-v3', 'tiny'] }))
})

test('picking the default saves it with its history, with nothing said', async () => {
  const { bridge } = await setup({ installedModels: ['tiny', 'small', 'diarize'] }, { transcribeModel: 'tiny', transcribeModelHistory: ['tiny'] })
  await act(() => selectTranscribeModel('small'))
  expect(await bridge.readSettings()).toMatchObject({ transcribeModel: 'small', transcribeModelHistory: ['tiny', 'small'] })
  expect(screen.queryByText(/is now the default transcription model/)).toBeNull()
})

test('a backend that stops answering keeps the default it had, with nothing said', async () => {
  let failing = false
  let refused = 0
  const { client, bridge } = await setup({ installedModels: ['small', 'diarize'] }, { transcribeModel: 'small', transcribeModelHistory: ['small'] })
  const listModels = client.listModels.bind(client)
  client.listModels = () => (failing ? (refused++, Promise.reject(new Error('Failed to fetch'))) : listModels())
  failing = true
  // Settings read the catalog again when they open.
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  await screen.findByRole('dialog', { name: 'Settings' })
  await waitFor(() => expect(refused).toBeGreaterThan(0))
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(screen.queryByText(/default transcription model/)).toBeNull()
  expect(await bridge.readSettings()).toMatchObject({ transcribeModel: 'small', transcribeModelHistory: ['small'] })
})
