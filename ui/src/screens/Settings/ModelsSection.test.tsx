import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { QUEUE_JOB, queueSnapshot } from '../../api/fixtures/data'
import { createFixtureClient, type FixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import type { QueueJob, QueueSnapshot } from '../../api/types'
import { App } from '../../App'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { OverlayProvider } from '../../OverlayProvider'
import type { ElectronSettings } from '../../platform/electron-api'
import { createMockElectronAPI } from '../../platform/electron-api-mock'
import { DEFAULT_SETTINGS } from '../../platform/settings'
import { alignedWithoutModel } from './AlignmentSection'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

async function setup(options: FixtureOptions = {}, saved: Partial<ElectronSettings> = {}) {
  const client = createFixtureClient({ downloadStepMs: 5, ...options })
  const bridge = createMockElectronAPI()
  await bridge.writeSettings({ ...DEFAULT_SETTINGS, ...saved })
  vi.stubGlobal('electronAPI', bridge)
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  return { client, bridge }
}

const settings = () => screen.getByRole('dialog', { name: 'Settings' })
async function openSection(name: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('tab', { name }))
}
const row = (name: string) => within(settings()).getByRole('group', { name })
const inRow = (name: string, button: string) => within(row(name)).queryByRole('button', { name: button })

test('Models lists Whisper and diarization with what is installed and the one in use', async () => {
  await setup({ installedModels: ['small', 'large-v3', 'diarize'] }, { transcribeModel: 'small', transcribeModelHistory: ['small'] })
  await openSection('Models')
  await within(settings()).findByRole('group', { name: 'Whisper Small' })
  expect(row('Whisper Small').textContent).toContain('In use')
  expect(inRow('Whisper Small', 'Use')).toBeNull()
  expect(row('Whisper Large v3').textContent).not.toMatch(/Recommended|Best|Installed/)
  expect(inRow('Whisper Large v3', 'Use')).toBeTruthy()
  expect(inRow('Whisper Tiny', 'Download')).toBeTruthy()
  expect(inRow('Diarization v2', 'Delete Diarization v2')).toBeTruthy()
  expect(row('Diarization v2').textContent).not.toContain('Speaker separation')
  expect(inRow('Diarization v2', 'Use')).toBeNull()
  expect(within(settings()).queryByRole('status')).toBeNull()
})

test('Use makes a model the default, saved with its history and without a toast', async () => {
  const { bridge } = await setup({ installedModels: ['small', 'large-v3', 'diarize'] }, { transcribeModel: 'small', transcribeModelHistory: ['small'] })
  await openSection('Models')
  await userEvent.click((await within(settings()).findByRole('group', { name: 'Whisper Large v3' })).querySelector('button')!)
  await waitFor(() => expect(row('Whisper Large v3').textContent).toContain('In use'))
  expect(await bridge.readSettings()).toMatchObject({ transcribeModel: 'large-v3', transcribeModelHistory: ['small', 'large-v3'] })
  expect(screen.queryByText(/is now the default transcription model/)).toBeNull()
})

test.each([
  [['diarize'], 'No model selected — download a Whisper model to transcribe'],
  [['small'], 'Diarization model not installed — download it to transcribe'],
])('without the models a job needs, a hint over the list (%o)', async (installedModels, hint) => {
  await setup({ installedModels })
  await openSection('Models')
  expect((await within(settings()).findByRole('status')).textContent!.trim()).toBe(hint)
})

test('a download shows its progress, goes on after Settings close, and its model is then installed', async () => {
  await setup({ installedModels: ['small', 'diarize'], downloadStepMs: 60 }, { transcribeModel: 'small' })
  await openSection('Models')
  await userEvent.click(inRow('Whisper Tiny', 'Download') ?? (await within(settings()).findByRole('group', { name: 'Whisper Tiny' })).querySelector('button')!)
  expect(await within(row('Whisper Tiny')).findByRole('progressbar')).toBeTruthy()
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull())
  await openSection('Models')
  await waitFor(() => expect(inRow('Whisper Tiny', 'Delete Whisper Tiny')).toBeTruthy(), { timeout: 2000 })
  expect(inRow('Whisper Tiny', 'Use')).toBeTruthy()
})

test('Cancel stops a download', async () => {
  const { client } = await setup({ installedModels: ['small', 'diarize'], downloadStepMs: 1000 })
  const cancel = vi.spyOn(client, 'cancelModelDownload')
  await openSection('Models')
  await userEvent.click((await within(settings()).findByRole('group', { name: 'Whisper Tiny' })).querySelector('button')!)
  await userEvent.click(await waitFor(() => inRow('Whisper Tiny', 'Cancel')!))
  await waitFor(() => expect(cancel).toHaveBeenCalled())
  await waitFor(() => expect(inRow('Whisper Tiny', 'Download')).toBeTruthy())
})

test('a failed download says why in its row, with no toast, and Retry starts it again', async () => {
  const { client } = await setup({ installedModels: ['small', 'diarize'], downloadFails: true })
  await openSection('Models')
  await userEvent.click((await within(settings()).findByRole('group', { name: 'Whisper Tiny' })).querySelector('button')!)
  const alert = await within(row('Whisper Tiny')).findByRole('alert')
  expect(alert.textContent).toBe('Download failed: Connection to huggingface.co timed out')
  expect(screen.getAllByText(/Connection to huggingface.co timed out/)).toHaveLength(1)
  const start = vi.spyOn(client, 'startModelDownload')
  await userEvent.click(inRow('Whisper Tiny', 'Retry')!)
  expect(start).toHaveBeenCalledWith('tiny', null)
})

test('Alignment lists the models of the languages, and which need none', async () => {
  await setup({ installedModels: ['small', 'diarize', 'ru'] })
  await openSection('Alignment')
  await within(settings()).findByRole('group', { name: 'Russian' })
  expect(inRow('Russian', 'Delete Russian')).toBeTruthy()
  expect(row('Russian').textContent).not.toMatch(/Русский|wav2vec2|Installed/)
  expect(inRow('Czech', 'Download')).toBeTruthy()
  expect(inRow('Czech', 'Use')).toBeNull()
  expect(settings().textContent).toContain(`Not needed for English, Español, Deutsch and Français.`)
  expect(alignedWithoutModel()).toEqual(['English', 'Español', 'Deutsch', 'Français'])
})

test('Alignment downloads a model', async () => {
  await setup({ installedModels: ['small', 'diarize'] })
  await openSection('Alignment')
  await userEvent.click((await within(settings()).findByRole('group', { name: 'Czech' })).querySelector('button')!)
  await waitFor(() => expect(inRow('Czech', 'Delete Czech')).toBeTruthy(), { timeout: 2000 })
})

test('the empty screen opens Settings on Models', async () => {
  await setup({ scenario: 'empty' })
  const centre = await screen.findByRole('main', { name: 'Transcript' })
  await userEvent.click(await within(centre).findByRole('button', { name: 'Settings' }))
  expect(within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('tab', { name: 'Models', selected: true })).toBeTruthy()
})

const job = (id: string, change: Partial<QueueJob>): QueueJob => ({ ...QUEUE_JOB, id, title: `Call ${id}`, ...change })
const queueOf = (client: FixtureClient, snapshot: Partial<QueueSnapshot>) => act(async () => {
  client.playEvents({ steps: [{ afterMs: 0, event: queueSnapshot(snapshot) }] })
  await new Promise(resolve => setTimeout(resolve, 20))
})
const alert = () => screen.queryByRole('alertdialog')

test('delete: a model no queued job needs goes at once, and the default moves on', async () => {
  const { client, bridge } = await setup({ installedModels: ['small', 'large-v3', 'diarize'] }, { transcribeModel: 'small', transcribeModelHistory: ['small'] })
  const remove = vi.spyOn(client, 'deleteModel')
  await openSection('Models')
  await userEvent.click(await within(settings()).findByRole('button', { name: 'Delete Whisper Small' }))
  expect(alert()).toBeNull()
  expect(remove).toHaveBeenCalledWith('small')
  await waitFor(() => expect(inRow('Whisper Small', 'Download')).toBeTruthy())
  expect(await screen.findByText('Whisper Large v3 is now the default transcription model')).toBeTruthy()
  await waitFor(async () => expect((await bridge.readSettings()).transcribeModel).toBe('large-v3'))
})

test('delete: a model queued jobs need asks first over Settings; Cancel keeps it, Delete deletes it', async () => {
  const { client } = await setup({ installedModels: ['small', 'large-v3', 'diarize'] })
  await queueOf(client, { jobs: [job('a', { whisper_model: 'small' }), job('b', { whisper_model: 'small', status: 'failed' })] })
  const remove = vi.spyOn(client, 'deleteModel')
  await openSection('Models')
  const button = await within(settings()).findByRole('button', { name: 'Delete Whisper Small' })
  await userEvent.click(button)
  const confirm = await screen.findByRole('alertdialog', { name: 'Delete Whisper Small?' })
  expect(confirm.textContent).toContain('2 jobs in the queue use Whisper Small. Delete anyway?')
  await waitFor(() => expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Cancel' })))
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(alert()).toBeNull())
  expect(remove).not.toHaveBeenCalled()
  expect(settings()).toBeTruthy()
  await waitFor(() => expect(document.activeElement).toBe(button))
  await userEvent.click(button)
  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(alert()).toBeNull())
  expect(remove).toHaveBeenCalledWith('small')
  await waitFor(() => expect(inRow('Whisper Small', 'Download')).toBeTruthy())
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
  // Its row has no delete button now: the focus is in Settings.
  await waitFor(() => expect(settings().contains(document.activeElement)).toBe(true))
})

test('delete: the diarization model with queued jobs counts every job', async () => {
  const { client } = await setup({ installedModels: ['small', 'diarize'] })
  await queueOf(client, { jobs: [job('a', { whisper_model: 'small' }), job('b', { whisper_model: 'large-v3' })] })
  await openSection('Models')
  await userEvent.click(await within(settings()).findByRole('button', { name: 'Delete Diarization v2' }))
  expect((await screen.findByRole('alertdialog')).textContent).toContain('2 jobs in the queue use Diarization v2.')
})

test('delete: the model of the running transcription cannot be deleted, and says why', async () => {
  const { client } = await setup({ installedModels: ['small', 'large-v3', 'diarize'] })
  await queueOf(client, { jobs: [job('a', { whisper_model: 'small', status: 'running' })], running_job_id: 'a' })
  await openSection('Models')
  await waitFor(() => expect(within(settings()).getByRole('button', { name: 'Delete Whisper Small' })).toHaveProperty('disabled', true))
  expect(within(settings()).getByLabelText('Whisper Small cannot be deleted: In use by the running transcription')).toBeTruthy()
  expect(within(settings()).getByRole('button', { name: 'Delete Diarization v2' })).toHaveProperty('disabled', true)
  expect(within(settings()).getByRole('button', { name: 'Delete Whisper Large v3' })).toHaveProperty('disabled', false)
})

test('delete: a refusal of the backend is said in a toast, and the model stays', async () => {
  await setup({ installedModels: ['small', 'diarize'], overrides: { deleteModel: () => Promise.reject(new ApiError(409, 'In use by the running transcription')) } })
  await openSection('Models')
  await userEvent.click(await within(settings()).findByRole('button', { name: 'Delete Whisper Small' }))
  expect(await screen.findByText('In use by the running transcription')).toBeTruthy()
  expect(inRow('Whisper Small', 'Delete Whisper Small')).toBeTruthy()
})

test('delete: the alignment model of the default language sets it to Detect, with a toast', async () => {
  const { bridge } = await setup({ installedModels: ['small', 'diarize', 'ru', 'uk'] }, { transcribeLang: 'ru' })
  await openSection('Alignment')
  await userEvent.click(await within(settings()).findByRole('button', { name: 'Delete Russian' }))
  expect(await screen.findByText('Default language changed to Detect automatically')).toBeTruthy()
  await waitFor(async () => expect((await bridge.readSettings()).transcribeLang).toBe('auto'))
  await userEvent.click(within(settings()).getByRole('button', { name: 'Delete Ukrainian' }))
  await waitFor(() => expect(inRow('Ukrainian', 'Download')).toBeTruthy())
  expect((await bridge.readSettings()).transcribeLang).toBe('auto')
})

test('delete: an alignment model queued jobs in its language need asks first', async () => {
  const { client } = await setup({ installedModels: ['small', 'diarize', 'ru'] })
  await queueOf(client, { jobs: [job('a', { language: 'ru' }), job('b', { language: null })] })
  await openSection('Alignment')
  await userEvent.click(await within(settings()).findByRole('button', { name: 'Delete Russian' }))
  expect((await screen.findByRole('alertdialog')).textContent).toContain('1 job in the queue uses Russian.')
})
