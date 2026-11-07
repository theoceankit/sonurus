import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { ApiProvider } from './api/ApiProvider'
import { QUEUE_JOB, queueSnapshot } from './api/fixtures/data'
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
