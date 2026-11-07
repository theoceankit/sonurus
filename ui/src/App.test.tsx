import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { ApiProvider } from './api/ApiProvider'
import { QUEUE_JOB, queueSnapshot } from './api/fixtures/data'
import { EVENT_SCRIPTS } from './api/fixtures/event-scripts'
import { createFixtureClient } from './api/fixtures/fixture-client'
import { App } from './App'
import { OverlayProvider } from './OverlayProvider'

test('says so while the backend is away, and stops when it is back', async () => {
  const client = createFixtureClient()
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  await screen.findByRole('region', { name: 'This week' })
  expect(screen.queryByText('Backend is not responding')).toBeNull()
  act(() => client.setConnected(false))
  expect(await screen.findByText('Backend is not responding')).toBeTruthy()
  expect(screen.getByRole('region', { name: 'This week' })).toBeTruthy()
  act(() => client.setConnected(true))
  await waitFor(() => expect(screen.queryByText('Backend is not responding')).toBeNull())
})

test('a finished job is a toast whose Open opens the recording; the queue shows it meanwhile', async () => {
  const client = createFixtureClient()
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  await screen.findByRole('region', { name: 'This week' })
  act(() => { client.playEvents({ ...EVENT_SCRIPTS.transcribing, steps: EVENT_SCRIPTS.transcribing.steps.map(s => ({ ...s, afterMs: 10 })) }) })
  const queue = await screen.findByRole('region', { name: 'Transcription queue' })
  expect(within(queue).getByRole('button', { name: /Planning call$/ })).toBeTruthy()
  const open = await screen.findByRole('button', { name: 'Open' }, { timeout: 10_000 })
  expect(screen.getAllByText('"Planning call" is ready').length).toBeGreaterThan(0)
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Transcription queue' })).toBeNull())
  await userEvent.click(open)
  await waitFor(() => {
    const current = screen.getAllByRole('button').filter(button => button.getAttribute('aria-current') === 'true')
    expect(current.map(button => button.textContent).join()).toMatch(/^Planning call/)
  })
}, 15_000) // The whole app, through a job's every step: slow under the full suite.

test('a failed job is an error toast; one on a missing alignment model opens its dialog instead', async () => {
  const client = createFixtureClient()
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  await screen.findByRole('region', { name: 'This week' })
  act(() => {
    client.playEvents({ steps: [{ afterMs: 0, event: { type: 'job_failed', job_id: 'x', title: 'Old call', error: 'Failed to load audio', error_code: null, error_language: null } }] })
  })
  expect((await screen.findAllByText('Transcription failed: "Old call"')).length).toBeGreaterThan(0)
  act(() => { client.playEvents({ ...EVENT_SCRIPTS.failed, steps: EVENT_SCRIPTS.failed.steps.map(s => ({ ...s, afterMs: 0 })) }) })
  await screen.findByRole('dialog')
  expect(screen.queryByText('Transcription failed: "Planning call"')).toBeNull()
})

test('a job picked in the queue takes the centre; a recording picked in the list brings it back', async () => {
  const client = createFixtureClient()
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  await screen.findByRole('region', { name: 'This week' })
  act(() => {
    client.playEvents({ steps: [{ afterMs: 0, event: queueSnapshot({
      jobs: [{ ...QUEUE_JOB, id: 'f', title: 'Old call', status: 'failed', error: 'Failed to load audio: invalid data\n  more of the log' }],
    }) }] })
  })
  const queue = await screen.findByRole('region', { name: 'Transcription queue' })
  await userEvent.click(within(queue).getByRole('button', { name: /Old call$/ }))
  const centre = screen.getByRole('main', { name: 'Transcript' })
  await within(centre).findByRole('heading', { name: 'Old call' })
  expect(within(centre).getByText('Transcription failed')).toBeTruthy()
  expect(within(centre).queryByText(/more of the log/)).toBeNull()
  await userEvent.click(within(centre).getByRole('button', { name: 'Show log' }))
  expect(await within(centre).findByText(/more of the log/)).toBeTruthy()
  expect(screen.getAllByRole('button').filter(button => button.getAttribute('aria-current') === 'true')).toHaveLength(1)

  // Retried, it waits: the centre follows it.
  await userEvent.click(within(centre).getByRole('button', { name: 'Retry' }))
  await within(centre).findByText('Waiting in the queue')

  await userEvent.click(within(screen.getByRole('region', { name: 'This week' })).getAllByRole('button')[0])
  await waitFor(() => expect(within(centre).queryByRole('heading', { name: 'Old call' })).toBeNull())

  // Deleted while picked, the job leaves the centre too.
  await userEvent.click(within(queue).getByRole('button', { name: /Old call$/ }))
  await within(centre).findByRole('heading', { name: 'Old call' })
  act(() => { client.playEvents({ steps: [{ afterMs: 0, event: queueSnapshot() }] }) })
  await waitFor(() => expect(within(centre).queryByRole('heading', { name: 'Old call' })).toBeNull())
}, 15_000)
