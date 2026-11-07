import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { BROKEN_SOURCE, BROKEN_SOURCE_ERROR, createFixtureClient } from '../api/fixtures/fixture-client'
import { dismissAllToasts } from '../components/Toast/toast-store'
import { OverlayProvider } from '../OverlayProvider'
import { RecordingProvider, useElapsedSeconds, useRecording } from './RecordingProvider'
import type { RecordingRequest, SessionDeps } from './session'
import type { ApiClient } from '../api/client'

afterEach(() => {
  dismissAllToasts()
  vi.useRealTimers()
})

const REQUEST: RecordingRequest = { mic: false, micDeviceId: null, system: true, systemSourceId: '@DEFAULT_MONITOR@', title: 'Standup', model: null, language: null }
const noAudio = (api: ApiClient): SessionDeps => ({
  api,
  platform: async () => 'linux',
  getUserMedia: () => Promise.reject(new Error('no microphone here')),
  connect: () => { throw new Error('no audio here') },
  createRecorder: () => { throw new Error('no audio here') },
})

let control: ReturnType<typeof useRecording>
function Probe() {
  control = useRecording()
  const seconds = useElapsedSeconds(control.startedAt)
  return <span data-testid="state">{`${control.phase} ${control.title} ${seconds}`}</span>
}

function setup(client = createFixtureClient()) {
  render(<ApiProvider client={client}><OverlayProvider><RecordingProvider deps={noAudio}><Probe /></RecordingProvider></OverlayProvider></ApiProvider>)
  return client
}
const state = () => screen.getByTestId('state').textContent

test('starting, then recording with a time that counts from the start; stop queues it and ends', async () => {
  const client = setup()
  act(() => control.start(REQUEST))
  expect(state()).toBe('starting Standup 0')
  await waitFor(() => expect(state()).toBe('live Standup 0'))
  expect((await client.getQueue()).recording).toBe(true)
  act(() => control.start(REQUEST))
  act(() => control.stop())
  expect(state()).toMatch(/^stopping Standup/)
  await waitFor(() => expect(state()).toBe('idle  0'))
  const queue = await client.getQueue()
  expect(queue.recording).toBe(false)
  expect(queue.jobs.map(job => job.title)).toEqual(['Standup'])
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
  await waitFor(async () => expect((await client.getQueue()).recording).toBe(false))
})

test('a recording that cannot be saved says why, and the app can record again', async () => {
  setup(createFixtureClient({ overrides: { stopCapture: () => Promise.reject(new Error('ffmpeg failed')) } }))
  act(() => control.start(REQUEST))
  await waitFor(() => expect(state()).toBe('live Standup 0'))
  act(() => control.stop())
  expect(await screen.findByText('Recording error: ffmpeg failed')).toBeTruthy()
  expect(state()).toBe('idle  0')
})
