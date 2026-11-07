import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
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
  expect(row('Whisper Large v3').textContent).toContain('Recommended')
  expect(inRow('Whisper Large v3', 'Use')).toBeTruthy()
  expect(inRow('Whisper Tiny', 'Download')).toBeTruthy()
  expect(row('Diarization v2').textContent).toContain('Installed')
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
  await waitFor(() => expect(row('Whisper Tiny').textContent).toContain('Installed'), { timeout: 2000 })
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
  expect(alert.textContent).toBe('Connection to huggingface.co timed out')
  expect(row('Whisper Tiny').textContent).toContain('Download failed')
  expect(screen.getAllByText('Connection to huggingface.co timed out')).toHaveLength(1)
  const start = vi.spyOn(client, 'startModelDownload')
  await userEvent.click(inRow('Whisper Tiny', 'Retry')!)
  expect(start).toHaveBeenCalledWith('tiny', null)
})

test('Alignment lists the models of the languages, and which need none', async () => {
  await setup({ installedModels: ['small', 'diarize', 'ru'] })
  await openSection('Alignment')
  await within(settings()).findByRole('group', { name: 'Russian' })
  expect(row('Russian').textContent).toContain('Installed')
  expect(row('Russian').textContent).toContain('Русский')
  expect(inRow('Czech', 'Download')).toBeTruthy()
  expect(inRow('Czech', 'Use')).toBeNull()
  expect(settings().textContent).toContain(`Not needed for English, Español, Deutsch and Français.`)
  expect(alignedWithoutModel()).toEqual(['English', 'Español', 'Deutsch', 'Français'])
})

test('Alignment downloads a model', async () => {
  await setup({ installedModels: ['small', 'diarize'] })
  await openSection('Alignment')
  await userEvent.click((await within(settings()).findByRole('group', { name: 'Czech' })).querySelector('button')!)
  await waitFor(() => expect(row('Czech').textContent).toContain('Installed'), { timeout: 2000 })
})

test('the empty screen opens Settings on Models', async () => {
  await setup({ scenario: 'empty' })
  const centre = await screen.findByRole('main', { name: 'Transcript' })
  await userEvent.click(await within(centre).findByRole('button', { name: 'Settings' }))
  expect(within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('tab', { name: 'Models', selected: true })).toBeTruthy()
})
