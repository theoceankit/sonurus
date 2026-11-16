import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { BROKEN_SOURCE, BROKEN_SOURCE_ERROR, createFixtureClient } from '../api/fixtures/fixture-client'
import { useQueueEventsSync } from '../api/queries'
import { dismissAllToasts } from '../components/Toast/toast-store'
import { OverlayProvider } from '../OverlayProvider'
import { RecordingProvider, useElapsedSeconds, useRecording, type RecordingRequest } from './RecordingProvider'

afterEach(() => {
  dismissAllToasts()
  vi.useRealTimers()
})

const REQUEST: RecordingRequest = { mic: true, micDeviceId: null, system: true, systemSourceId: '@DEFAULT_MONITOR@', title: 'Standup', model: null, language: null }

let control: ReturnType<typeof useRecording>
function Probe() {
  control = useRecording()
  const seconds = useElapsedSeconds(control.startedAt)
  return <span data-testid="state">{`${control.phase} ${control.title} ${seconds}`}</span>
}
function QueueSync() {
  useQueueEventsSync()
  return null
}

function setup(client = createFixtureClient()) {
  render(<ApiProvider client={client}><OverlayProvider><RecordingProvider><QueueSync /><Probe /></RecordingProvider></OverlayProvider></ApiProvider>)
  return client
}
const state = () => screen.getByTestId('state').textContent

test('starting, then recording with a time that counts from the start; stop queues it and ends', async () => {
  const client = createFixtureClient()
  // The backend takes its time to start the tracks.
  let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const startRecording = client.startRecording
  client.startRecording = async request => { await ready; return startRecording(request) }
  setup(client)
  act(() => control.start(REQUEST))
  expect(state()).toBe('starting Standup 0')
  await act(async () => started())
  await waitFor(() => expect(state()).toBe('live Standup 0'))
  expect((await client.getQueue()).recording).toMatchObject({ phase: 'live', title: 'Standup', sources: ['mic', 'system'] })
  act(() => control.start(REQUEST))
  act(() => control.stop())
  expect(state()).toMatch(/^stopping Standup/)
  await waitFor(() => expect(state()).toBe('idle  0'))
  const queue = await client.getQueue()
  expect(queue.recording).toBeNull()
  expect(queue.jobs.map(job => job.title)).toEqual(['Standup'])
})

test('a window opened mid-recording shows it live, with the time since it started, and can stop it', async () => {
  const client = createFixtureClient()
  await client.startRecording({ mic: true, mic_device: null, system: false, system_source: null, title: 'Standup', whisper_model: null, language: null })
  vi.useFakeTimers({ shouldAdvanceTime: true })
  await act(async () => { vi.advanceTimersByTime(90_000) })
  setup(client)
  await waitFor(() => expect(state()).toBe('live Standup 90'))
  act(() => control.stop())
  await waitFor(() => expect(state()).toBe('idle  0'))
  expect((await client.getQueue()).jobs.map(job => job.title)).toEqual(['Standup'])
})

test('the time goes on while it records', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  setup()
  act(() => control.start(REQUEST))
  await waitFor(() => expect(state()).toBe('live Standup 0'))
  await act(async () => { vi.advanceTimersByTime(62_000) })
  expect(state()).toBe('live Standup 62')
})

test('a recording that cannot start says why and leaves nothing running', async () => {
  const client = setup()
  act(() => control.start({ ...REQUEST, systemSourceId: BROKEN_SOURCE }))
  expect(await screen.findByText(`Could not start recording: ${BROKEN_SOURCE_ERROR}`)).toBeTruthy()
  expect(state()).toBe('idle  0')
  expect((await client.getQueue()).recording).toBeNull()
})

test('a Stop the backend refuses says why and the recording goes on', async () => {
  setup(createFixtureClient({ overrides: { stopRecording: () => Promise.reject(new Error('No recording is in progress')) } }))
  act(() => control.start(REQUEST))
  await waitFor(() => expect(state()).toBe('live Standup 0'))
  act(() => control.stop())
  expect(await screen.findByText('Recording error: No recording is in progress')).toBeTruthy()
  expect(state()).toBe('live Standup 0')
})
