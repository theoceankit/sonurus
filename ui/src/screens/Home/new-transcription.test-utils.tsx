import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import type { ApiClient } from '../../api/client'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { Modal } from '../../components/Modal/Modal'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'
import { OverlayProvider } from '../../OverlayProvider'
import { createMockElectronAPI } from '../../platform/electron-api-mock'
import type { ElectronAPI } from '../../platform/electron-api'
import { RecordingProvider, useRecording } from '../../recording/RecordingProvider'
import type { SessionDeps } from '../../recording/session'
import { SettingsProvider } from '../Settings/SettingsProvider'
import { ImportDialog } from './ImportDialog'
import { NewRecordingDialog } from './NewRecordingDialog'
import { useNewTranscription } from './useNewTranscription'

// New recording and Import files as the Editor has them, without the Editor: the plus
// of the title bar is a button of the same name.

// Another window open over the page, as Delete recording or New speaker would be.
function OtherWindow() {
  return <Modal open><ModalHeader title="Other window" /></Modal>
}

// The window's audio in jsdom: system audio only, the backend's fixture captures it.
const noMicrophone = (api: ApiClient): SessionDeps => ({
  api,
  platform: async () => 'linux',
  getUserMedia: () => Promise.reject(new Error('no microphone here')),
  connect: () => { throw new Error('no audio here') },
  createRecorder: () => { throw new Error('no audio here') },
})

export let recordingControl: ReturnType<typeof useRecording>

function Dialogs() {
  const dialogs = useNewTranscription()
  recordingControl = useRecording()
  return (
    <>
      <button type="button" onClick={dialogs.openRecording}>New recording</button>
      <NewRecordingDialog {...dialogs.record} />
      <ImportDialog {...dialogs.importer} />
    </>
  )
}

export interface SetupOptions {
  // What the system's file dialog returns.
  chosen?: string[]
  // Saved in the settings file before the start.
  settings?: object
  // Another window over the page.
  other?: boolean
  // Over the bridge of Electron.
  bridge?: Partial<ElectronAPI>
}

export async function setup(options: FixtureOptions = {}, { chosen = [], settings = {}, other = false, bridge = {} }: SetupOptions = {}) {
  const client = createFixtureClient(options)
  const electron = createMockElectronAPI({ openFiles: async () => chosen })
  await electron.writeSettings({ ...await electron.readSettings(), ...settings })
  vi.stubGlobal('electronAPI', { ...electron, ...bridge })
  render(
    <ApiProvider client={client}><OverlayProvider><RecordingProvider deps={noMicrophone}><SettingsProvider>
      <Dialogs />{other && <OtherWindow />}
    </SettingsProvider></RecordingProvider></OverlayProvider></ApiProvider>,
  )
  return client
}

// jsdom has no DragEvent or DataTransfer.
export function drag(type: string, { files = ['a.mp3'], types = ['Files'] } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { types, files: files.map(name => new File([], name)), dropEffect: 'none' } })
  act(() => { document.body.dispatchEvent(event) })
  return event
}

export const recordDialog = () => screen.queryByRole('dialog', { name: 'New recording' })
export const importDialog = () => screen.queryByRole('dialog', { name: 'Import files' })
// Under another window, which hides the rest of the page from assistive technology,
// so it has no accessible name to be found by.
export const importDialogUnder = () => screen.queryAllByRole('dialog', { hidden: true }).find(window => window.textContent!.startsWith('Import files')) ?? null
export const recordDialogUnder = () => screen.queryAllByRole('dialog', { hidden: true }).find(window => window.textContent!.startsWith('New recording')) ?? null
export const listed = () => within(screen.getByRole('list', { name: 'Files to import' })).getAllByRole('listitem').map(item => item.textContent!.trim())
export const openRecording = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'New recording' }))
  return screen.findByRole('dialog', { name: 'New recording' })
}
export const openImport = async () => {
  await openRecording()
  await userEvent.click(screen.getByRole('button', { name: 'Import files' }))
  return screen.findByRole('dialog', { name: 'Import files' })
}
// Renames a listed file by its name: a click on the name, the title typed, Enter.
export async function rename(name: string, title: string) {
  await userEvent.click(screen.getByRole('button', { name: `Rename ${name}` }))
  const field = screen.getByRole('textbox', { name: `Title of ${name}` })
  await userEvent.clear(field)
  await userEvent.type(field, `${title}{Enter}`)
}
export const chooseFiles = () => userEvent.click(screen.getByRole('button', { name: 'Choose files' }))
export const importButton = () => screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement
// A select is named by its label and its value.
export const field = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}( |$)`) })
export const option = (name: RegExp) => screen.getByRole('menuitemradio', { name })
export const jobs = async (client: ApiClient) => (await client.getQueue()).jobs.map(job => ({
  title: job.title, model: job.whisper_model, language: job.language,
}))
