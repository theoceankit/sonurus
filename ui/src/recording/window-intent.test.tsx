import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { QUEUE_JOB, queueSnapshot, WEEKLY_SYNC_ID } from '../api/fixtures/data'
import { createFixtureClient, type FixtureClient } from '../api/fixtures/fixture-client'
import type { QueueJob } from '../api/types'
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

// A click on a notification of a finished or failed transcription opens the recording,
// the failed job, or the Alignment model dialog of the model it lacked; nothing that is gone.

const failedJob = (id: string, changes: Partial<QueueJob> = {}): QueueJob => ({
  ...QUEUE_JOB, id, title: `Call ${id}`, status: 'failed', error: 'CUDA out of memory', ...changes,
})

async function setupWithQueue(first: WindowIntent | null, jobs: QueueJob[] = []) {
  const client: FixtureClient = createFixtureClient()
  const { bridge, tell } = bridgeWith(first)
  vi.stubGlobal('electronAPI', bridge)
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  // The queue as the backend sends it, before the click.
  await act(async () => {
    await new Promise<void>(resolve => {
      client.playEvents({ steps: [{ afterMs: 0, event: queueSnapshot({ jobs }) }] })
      setTimeout(resolve, 20)
    })
  })
  return { client, tell }
}

const title = () => screen.findByRole('heading', { level: 1 })

test('a finished transcription opens its recording', async () => {
  await setupWithQueue({ open: 'recording', transcriptId: WEEKLY_SYNC_ID })
  await waitFor(async () => expect((await title()).textContent).toBe('Weekly product sync'))
})

test('a finished transcription opens its recording in a window already open', async () => {
  const { tell } = await setupWithQueue(null)
  await waitFor(async () => expect((await title()).textContent).toBe('Design review'))
  tell({ open: 'recording', transcriptId: WEEKLY_SYNC_ID })
  await waitFor(async () => expect((await title()).textContent).toBe('Weekly product sync'))
})

test('a recording deleted since opens nothing, and says nothing', async () => {
  await setupWithQueue({ open: 'recording', transcriptId: 999 })
  await waitFor(async () => expect((await title()).textContent).toBe('Design review'))
  await new Promise(resolve => setTimeout(resolve, 50))
  expect((await title()).textContent).toBe('Design review')
  expect(screen.queryByRole('alert')).toBeNull()
})

test('a failed transcription shows its job with the error', async () => {
  const { tell } = await setupWithQueue(null, [failedJob('j1')])
  tell({ open: 'job', jobId: 'j1' })
  await waitFor(async () => expect((await title()).textContent).toBe('Call j1'))
  expect(screen.getByRole('button', { name: 'Show log' })).toBeTruthy()
})

test('a job gone from the queue opens nothing', async () => {
  const { tell } = await setupWithQueue(null, [failedJob('j1')])
  tell({ open: 'job', jobId: 'gone' })
  await waitFor(async () => expect((await title()).textContent).toBe('Design review'))
  await new Promise(resolve => setTimeout(resolve, 50))
  expect((await title()).textContent).toBe('Design review')
})

test('a missing alignment model opens its dialog while a job still waits for it', async () => {
  const job = failedJob('j1', { language: 'cs', error: 'Alignment model for language "cs" is not installed.', error_code: 'alignment_model_missing', error_language: 'cs' })
  const { tell } = await setupWithQueue(null, [job])
  expect(screen.queryByRole('dialog')).toBeNull()
  tell({ open: 'alignment-model', language: 'cs' })
  const dialog = await screen.findByRole('dialog')
  expect(dialog.textContent).toContain('Czech')
})

test('a missing alignment model with no job left for it opens nothing', async () => {
  const { tell } = await setupWithQueue(null, [])
  await screen.findByRole('region', { name: 'This week' })
  tell({ open: 'alignment-model', language: 'cs' })
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(screen.queryByRole('dialog')).toBeNull()
})
