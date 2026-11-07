import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import type { ApiClient } from '../api/client'
import { createFixtureClient } from '../api/fixtures/fixture-client'
import { dismissAllToasts } from '../components/Toast/toast-store'
import { OverlayProvider } from '../OverlayProvider'
import { createMockElectronAPI } from '../platform/electron-api-mock'
import { EditorScreen } from '../screens/Editor/EditorScreen'
import { SettingsProvider } from '../screens/Settings/SettingsProvider'
import { RecordingProvider, useRecording } from './RecordingProvider'
import type { SessionDeps } from './session'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

const systemOnly = (api: ApiClient): SessionDeps => ({
  api,
  platform: async () => 'linux',
  getUserMedia: () => Promise.reject(new Error('no microphone here')),
  connect: () => { throw new Error('no audio here') },
  createRecorder: () => { throw new Error('no audio here') },
})

let control: ReturnType<typeof useRecording>
const Probe = () => { control = useRecording(); return null }

async function recording() {
  const client = createFixtureClient()
  vi.stubGlobal('electronAPI', createMockElectronAPI())
  render(
    <ApiProvider client={client}><OverlayProvider><RecordingProvider deps={systemOnly}><SettingsProvider>
      <EditorScreen /><Probe />
    </SettingsProvider></RecordingProvider></OverlayProvider></ApiProvider>,
  )
  await screen.findAllByRole('button', { name: /Weekly product sync/ })
  act(() => control.start({ mic: false, micDeviceId: null, system: true, systemSourceId: '@DEFAULT_MONITOR@', title: 'Standup', model: null, language: null }))
  return client
}

const section = () => screen.queryByRole('region', { name: 'Recording' })

test('the recording stands above the queue in the sidebar, and its Stop queues it', async () => {
  const client = await recording()
  expect(within(section()!).getByText('Starting')).toBeTruthy()
  await waitFor(() => expect(within(section()!).getByText('0:00')).toBeTruthy())
  expect(within(section()!).getByText('Standup')).toBeTruthy()
  await userEvent.click(within(section()!).getByRole('button', { name: 'Stop recording' }))
  await waitFor(() => expect(section()).toBeNull())
  expect((await client.getQueue()).jobs.map(job => job.title)).toEqual(['Standup'])
})

test('with the sidebar hidden a pill in the title bar shows it, and its menu stops it', async () => {
  const client = await recording()
  await waitFor(() => expect(control.phase).toBe('live'))
  const titlebar = screen.getByRole('button', { name: 'Toggle sidebar' }).closest('header')!
  expect(within(titlebar).queryByRole('button', { name: /^Recording/ })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
  await userEvent.click(within(titlebar).getByRole('button', { name: 'Recording 0:00' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Stop recording' }))
  await waitFor(async () => expect((await client.getQueue()).jobs.map(job => job.title)).toEqual(['Standup']))
  expect(within(titlebar).queryByRole('button', { name: /^Recording|Stopping/ })).toBeNull()
})
