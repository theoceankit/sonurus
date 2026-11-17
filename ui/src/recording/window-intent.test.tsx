import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { createFixtureClient, type FixtureClient } from '../api/fixtures/fixture-client'
import { App } from '../App'
import { dismissAllToasts } from '../components/Toast/toast-store'
import { OverlayProvider } from '../OverlayProvider'
import type { WindowIntent } from '../platform/electron-api'
import { createMockElectronAPI } from '../platform/electron-api-mock'

// A click on a notification of the main process opens the window with a dialog: New
// recording when a call seems to have started, Stop recording when it seems to have ended.

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

function bridgeWith(first: WindowIntent | null) {
  const intents: (WindowIntent | null)[] = [first]
  let told: (() => void) | null = null
  const bridge = createMockElectronAPI({
    takeWindowIntent: async () => intents.shift() ?? null,
    onWindowIntent: callback => { told = callback; return () => { told = null } },
  })
  // The main process has a new intent for the window that is already open.
  const tell = (intent: WindowIntent) => { intents.push(intent); act(() => told?.()) }
  return { bridge, tell }
}

async function setup(first: WindowIntent | null, recording = false) {
  const client: FixtureClient = createFixtureClient()
  if (recording) {
    await client.startRecording({ mic: true, mic_device: null, system: true, system_source: null, title: 'Standup', whisper_model: null, language: null })
  }
  const { bridge, tell } = bridgeWith(first)
  vi.stubGlobal('electronAPI', bridge)
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  // A dialog opened at once hides the rest of the window.
  if (!first) await screen.findByRole('region', { name: 'This week' })
  return { client, tell }
}

test('a call that started opens New recording titled after the app', async () => {
  await setup({ dialog: 'new-recording', app: 'Discord' })
  const dialog = await screen.findByRole('dialog', { name: 'New recording' })
  expect(within(dialog).getByRole('textbox', { name: 'Title' }).getAttribute('placeholder')).toMatch(/^\d+ \w{3} \d\d:\d\d Discord call$/)
})

test('an app without a name gives the usual title', async () => {
  await setup({ dialog: 'new-recording', app: null })
  const dialog = await screen.findByRole('dialog', { name: 'New recording' })
  expect(within(dialog).getByRole('textbox', { name: 'Title' }).getAttribute('placeholder')).toMatch(/Meeting$/)
})

test('an intent for the open window opens the dialog too', async () => {
  const { tell } = await setup(null)
  expect(screen.queryByRole('dialog', { name: 'New recording' })).toBeNull()
  tell({ dialog: 'new-recording', app: 'Zoom' })
  expect(await screen.findByRole('dialog', { name: 'New recording' })).toBeTruthy()
})

test('a call that ended asks whether to stop the recording, and Stop recording stops it', async () => {
  const { client } = await setup({ dialog: 'stop-recording' }, true)
  const dialog = await screen.findByRole('dialog', { name: 'Stop recording?' })
  expect(dialog.textContent).toContain('Standup')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Stop recording' }))
  await waitFor(async () => expect((await client.getQueue()).recording).toBeNull())
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stop recording?' })).toBeNull())
})

test('Keep recording leaves it running', async () => {
  const { client } = await setup({ dialog: 'stop-recording' }, true)
  const dialog = await screen.findByRole('dialog', { name: 'Stop recording?' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Keep recording' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stop recording?' })).toBeNull())
  expect((await client.getQueue()).recording?.phase).toBe('live')
})

test('with no recording running, nothing is asked', async () => {
  await setup({ dialog: 'stop-recording' })
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(screen.queryByRole('dialog', { name: 'Stop recording?' })).toBeNull()
})
