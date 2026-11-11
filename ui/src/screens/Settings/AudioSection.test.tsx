import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import type { ApiClient } from '../../api/client'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { App } from '../../App'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { OverlayProvider } from '../../OverlayProvider'
import { createMockElectronAPI } from '../../platform/electron-api-mock'
import { DEFAULT_SETTINGS } from '../../platform/settings'
import { RecordingProvider, useRecording } from '../../recording/RecordingProvider'
import type { SessionDeps } from '../../recording/session'
import { SettingsProvider } from './SettingsProvider'
import { EditorScreen } from '../Editor/EditorScreen'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

async function setup(options: FixtureOptions = {}, saved: object = {}) {
  const bridge = createMockElectronAPI()
  await bridge.writeSettings({ ...DEFAULT_SETTINGS, ...saved })
  vi.stubGlobal('electronAPI', bridge)
  render(<ApiProvider client={createFixtureClient(options)}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  await screen.findByRole('region', { name: 'This week' })
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('tab', { name: 'Audio devices' }))
  return bridge
}
// A select is named by its label and its value.
const field = (name: string) => screen.getByRole('combobox', { name })

test('shows the saved devices and saves a new one for the next recording', async () => {
  const bridge = await setup({}, { recordingSystemDevice: 'bluez_output.58_18_62_38_72_FA.1.monitor' })
  expect(field('Microphone').textContent).toContain('Default microphone')
  await waitFor(() => expect(field('System audio source').textContent).toContain('WH-1000XM5'))
  await userEvent.click(field('System audio source'))
  await userEvent.click(screen.getByRole('option', { name: /System audio \(default\)/ }))
  await waitFor(async () => expect((await bridge.readSettings()).recordingSystemDevice).toBe('@DEFAULT_MONITOR@'))
})

test('a computer with no system audio says so, and the field is off', async () => {
  await setup({ captureSources: [] })
  await waitFor(() => expect(field('System audio source').textContent).toContain('Not available'))
  expect((field('System audio source') as HTMLButtonElement).disabled).toBe(true)
})

test('Include microphone is not there: the dialog turns the microphone on and off', async () => {
  await setup()
  expect(within(screen.getByRole('dialog', { name: 'Settings' })).queryByText('Include microphone')).toBeNull()
})

test('Delete all data waits for a live recording to stop', async () => {
  const deps = (api: ApiClient): SessionDeps => ({
    api,
    platform: async () => 'linux',
    getUserMedia: () => Promise.reject(new Error('no microphone')),
    connect: () => { throw new Error('no audio') },
    createRecorder: () => { throw new Error('no audio') },
  })
  let control!: ReturnType<typeof useRecording>
  const Probe = () => { control = useRecording(); return null }
  vi.stubGlobal('electronAPI', createMockElectronAPI())
  render(
    <ApiProvider client={createFixtureClient()}><OverlayProvider><RecordingProvider deps={deps}><SettingsProvider>
      <EditorScreen /><Probe />
    </SettingsProvider></RecordingProvider></OverlayProvider></ApiProvider>,
  )
  await screen.findByRole('region', { name: 'This week' })
  act(() => control.start({ mic: false, micDeviceId: null, system: true, systemSourceId: '@DEFAULT_MONITOR@', title: 'Live', model: null, language: null }))
  await waitFor(() => expect(control.phase).toBe('live'))
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('tab', { name: 'Data' }))
  const remove = within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('button', { name: 'Delete' })
  expect(remove.getAttribute('aria-disabled') === 'true' || (remove as HTMLButtonElement).disabled).toBe(true)
  await userEvent.hover(remove.parentElement ?? remove)
  expect((await screen.findByRole('tooltip')).textContent).toBe('Stop the live recording first.')
})
