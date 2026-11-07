import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { QUEUE_JOB, queueSnapshot } from '../../api/fixtures/data'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { DEFAULT_INSTALLED } from '../../api/fixtures/models'
import type { QueueJob, QueueUpdate } from '../../api/types'
import { App } from '../../App'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { NOT_IMPLEMENTED_TOAST } from '../../not-implemented'
import { OverlayProvider } from '../../OverlayProvider'
import { modelDownloadsFor } from '../../transcribe/model-downloads'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

const failedJob = (id: string, language: string): QueueJob => ({
  ...QUEUE_JOB, id, title: `Call ${id}`, language, status: 'failed',
  error: `Alignment model for language "${language}" is not installed. Download it in Settings.`,
  error_code: 'alignment_model_missing', error_language: language,
})
const failure = (job: QueueJob): QueueUpdate => ({
  type: 'job_failed', job_id: job.id, title: job.title, error: job.error!, error_code: job.error_code, error_language: job.error_language,
})

function setup(options: FixtureOptions = {}) {
  const client = createFixtureClient({ downloadStepMs: 5, ...options })
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  // Jobs fail: each one's snapshot, then its event, as the backend sends them.
  const fail = (...jobs: QueueJob[]) => act(async () => {
    await new Promise<void>(resolve => {
      client.playEvents({ steps: [{ afterMs: 0, event: queueSnapshot({ jobs }) }, ...jobs.map(job => ({ afterMs: 0, event: failure(job) }))] })
      setTimeout(resolve, 20)
    })
  })
  return { client, fail }
}

const dialog = () => screen.queryByRole('dialog')
const button = (name: string | RegExp) => within(screen.getByRole('dialog')).getByRole('button', { name })

test('two failures of one language open one dialog; another language waits for it', async () => {
  const { fail } = setup()
  await screen.findByRole('region', { name: 'This week' })
  await fail(failedJob('a', 'cs'), failedJob('b', 'cs'), failedJob('c', 'pt'))
  expect(await screen.findAllByRole('dialog')).toHaveLength(1)
  expect(dialog()?.textContent).toContain('Czech')
  expect(dialog()?.textContent).toContain('Download it to get word-level timestamps for this language.')
  await userEvent.click(button('Dismiss'))
  await waitFor(() => expect(dialog()?.textContent).toContain('Portuguese'))
  // The window before it takes a moment to give the page back.
  await userEvent.click(await waitFor(() => button('Dismiss')))
  await waitFor(() => expect(dialog()).toBeNull())
})

test('after Dismiss the next failure opens the dialog again', async () => {
  const { fail } = setup()
  await screen.findByRole('region', { name: 'This week' })
  await fail(failedJob('a', 'cs'))
  await userEvent.click(await waitFor(() => button('Dismiss')))
  await waitFor(() => expect(dialog()).toBeNull())
  await fail(failedJob('b', 'cs'))
  expect(await screen.findByRole('dialog')).toBeTruthy()
})

test('Download shows progress, then one button retries every job that failed on the model', async () => {
  const { client, fail } = setup()
  await screen.findByRole('region', { name: 'This week' })
  const start = vi.spyOn(client, 'startModelDownload')
  await fail(failedJob('a', 'cs'), failedJob('b', 'pt'), failedJob('c', 'cs'))
  await userEvent.click(await waitFor(() => button('Download ~300 MB')))
  expect(await within(dialog()!).findByRole('progressbar')).toBeTruthy()
  expect(dialog()?.textContent).toContain('Downloading Czech alignment model…')
  // A second failure of the language while it downloads joins it.
  await fail(failedJob('a', 'cs'), failedJob('b', 'pt'), failedJob('c', 'cs'))
  expect(start).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(dialog()?.textContent).toContain('Download complete'))
  expect(dialog()?.textContent).toContain('Czech alignment model is ready.')
  await userEvent.click(button('Retry 2 transcriptions'))
  await waitFor(async () => {
    const jobs = (await client.getQueue()).jobs
    expect(jobs.map(job => [job.id, job.status])).toEqual([['b', 'failed'], ['a', 'waiting'], ['c', 'waiting']])
  })
})

test('a download started elsewhere shows as progress, not as Download', async () => {
  const { client, fail } = setup({ downloadStepMs: 1000 })
  await screen.findByRole('region', { name: 'This week' })
  // As Settings will: through the downloads of the same client.
  await act(() => modelDownloadsFor(client).start('cs'))
  await fail(failedJob('a', 'cs'))
  expect(await within(dialog()!).findByRole('progressbar')).toBeTruthy()
  expect(within(dialog()!).queryByRole('button', { name: /^Download/ })).toBeNull()
})

test('a model installed by the time the dialog opens is ready at once', async () => {
  const { fail } = setup({ installedModels: [...DEFAULT_INSTALLED, 'cs'] })
  await screen.findByRole('region', { name: 'This week' })
  await fail(failedJob('a', 'cs'))
  await waitFor(() => expect(dialog()?.textContent).toContain('Download complete'))
  expect(await waitFor(() => button('Retry transcription'))).toBeTruthy()
})

test('a failed download says so and offers to try again, or Settings', async () => {
  const { client, fail } = setup({ downloadFails: true })
  await screen.findByRole('region', { name: 'This week' })
  await fail(failedJob('a', 'cs'))
  await userEvent.click(await waitFor(() => button('Download ~300 MB')))
  await waitFor(() => expect(dialog()?.textContent).toContain('Download failed'))
  const start = vi.spyOn(client, 'startModelDownload')
  await userEvent.click(button('Try again'))
  expect(start).toHaveBeenCalledTimes(1)
})

test('Open Settings closes the dialog for Settings', async () => {
  const { fail } = setup({ downloadFails: true })
  await screen.findByRole('region', { name: 'This week' })
  await fail(failedJob('a', 'cs'))
  await userEvent.click(await waitFor(() => button('Download ~300 MB')))
  await waitFor(() => expect(dialog()?.textContent).toContain('Download failed'))
  await userEvent.click(button('Open Settings'))
  expect(within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('tab', { name: 'Alignment', selected: true })).toBeTruthy()
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Download failed' })).toBeNull())
})

test('Cancel stops the download and closes the dialog', async () => {
  const { client, fail } = setup({ downloadStepMs: 1000 })
  await screen.findByRole('region', { name: 'This week' })
  const cancel = vi.spyOn(client, 'cancelModelDownload')
  await fail(failedJob('a', 'cs'))
  await userEvent.click(await waitFor(() => button('Download ~300 MB')))
  await within(dialog()!).findByRole('progressbar')
  await userEvent.click(button('Cancel'))
  await waitFor(() => expect(dialog()).toBeNull())
  expect(cancel).toHaveBeenCalledWith('cs', expect.any(String))
})

test('another failure is left to the queue: no dialog', async () => {
  const { client } = setup()
  await screen.findByRole('region', { name: 'This week' })
  const job = { ...failedJob('a', 'cs'), error_code: 'whisper_model_missing', error_language: null }
  await act(async () => {
    client.playEvents({ steps: [{ afterMs: 0, event: failure(job) }] })
    await new Promise(resolve => setTimeout(resolve, 20))
  })
  expect(dialog()).toBeNull()
})
