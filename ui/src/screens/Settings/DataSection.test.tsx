import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { QUEUE_JOB, queueSnapshot } from '../../api/fixtures/data'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { App } from '../../App'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { OverlayProvider } from '../../OverlayProvider'
import { createMockElectronAPI } from '../../platform/electron-api-mock'
import { DEFAULT_SETTINGS } from '../../platform/settings'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

async function setup(options: FixtureOptions = {}) {
  const client = createFixtureClient(options)
  const setZoom = vi.fn(async () => {})
  const bridge = createMockElectronAPI({ setZoom })
  await bridge.writeSettings({
    ...DEFAULT_SETTINGS, scale: 150, transcribeLang: 'de', transcribeModel: 'small', transcribeModelHistory: ['small'], hfToken: 'hf_kept', recentTranscriptIds: [3, 1],
  })
  vi.stubGlobal('electronAPI', bridge)
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  await screen.findByRole('region', { name: 'This week' })
  return { client, bridge, setZoom }
}

const settings = () => screen.getByRole('dialog', { name: 'Settings' })
async function openData() {
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('tab', { name: 'Data' }))
}
const confirmDialog = () => screen.queryByRole('alertdialog')

test('Reset asks over Settings, then puts every preference back but the token and the recent recordings', async () => {
  const { bridge, setZoom } = await setup()
  await openData()
  await userEvent.click(within(settings()).getByRole('button', { name: 'Reset' }))
  const confirm = await screen.findByRole('alertdialog', { name: 'Reset preferences?' })
  expect(confirm.textContent).toContain('your HuggingFace token are kept')
  await userEvent.click(within(confirm).getByRole('button', { name: 'Reset' }))
  await waitFor(() => expect(confirmDialog()).toBeNull())
  expect(await screen.findByText('Preferences reset to defaults.')).toBeTruthy()
  expect(await bridge.readSettings()).toEqual({ ...DEFAULT_SETTINGS, hfToken: 'hf_kept', recentTranscriptIds: [3, 1] })
  expect(setZoom).toHaveBeenLastCalledWith(1)
  expect(settings()).toBeTruthy()
})

test('Cancel resets nothing', async () => {
  const { bridge } = await setup()
  await openData()
  await userEvent.click(within(settings()).getByRole('button', { name: 'Reset' }))
  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(confirmDialog()).toBeNull())
  expect((await bridge.readSettings()).scale).toBe(150)
})

test('Delete all data asks first, deletes, says what went, and the library is empty', async () => {
  await setup()
  await openData()
  await userEvent.click(within(settings()).getByRole('button', { name: 'Delete' }))
  const confirm = await screen.findByRole('alertdialog', { name: 'Delete all data?' })
  expect(confirm.textContent).toContain('This cannot be undone.')
  await waitFor(() => expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Cancel' })))
  await userEvent.click(within(confirm).getByRole('button', { name: 'Delete everything' }))
  expect(await screen.findByText(/^Deleted \d+ transcripts?, \d+ speakers? and \d+ files?\.$/)).toBeTruthy()
  await userEvent.click(within(settings()).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull())
  expect(await within(screen.getByRole('main', { name: 'Transcript' })).findByText(/To make a new transcription, press/)).toBeTruthy()
})

test('Delete all data is off while a transcription runs, and says why', async () => {
  const { client } = await setup()
  await act(async () => {
    client.playEvents({ steps: [{ afterMs: 0, event: queueSnapshot({ jobs: [{ ...QUEUE_JOB, id: 'a', status: 'running' }], running_job_id: 'a' }) }] })
    await new Promise(resolve => setTimeout(resolve, 20))
  })
  await openData()
  expect(within(settings()).getByRole('button', { name: 'Delete' })).toHaveProperty('disabled', true)
  expect(within(settings()).getByLabelText('Delete all data: Pause the transcription queue first.')).toBeTruthy()
})

test('a refusal of the backend is said in a toast', async () => {
  await setup({ overrides: { resetData: () => Promise.reject(new ApiError(409, 'A recording is in progress')) } })
  await openData()
  await userEvent.click(within(settings()).getByRole('button', { name: 'Delete' }))
  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete everything' }))
  expect(await screen.findByText('Could not delete data: A recording is in progress')).toBeTruthy()
  expect(screen.getByRole('region', { name: 'This week', hidden: true })).toBeTruthy()
})
