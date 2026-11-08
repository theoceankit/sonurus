import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, test, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { createFixtureClient } from '../api/fixtures/fixture-client'
import { useModels } from '../api/queries'
import { createModelDownloads, useModelDownloads } from './model-downloads'

const noToken = async () => null

test('one download per model, with its progress, ending done', async () => {
  const client = createFixtureClient({ downloadStepMs: 1 })
  const start = vi.spyOn(client, 'startModelDownload')
  const downloads = createModelDownloads(client, async () => 'hf_x')
  const seen: (number | null)[] = []
  downloads.subscribe(id => seen.push(downloads.download(id)?.pct ?? null))
  await Promise.all([downloads.start('cs'), downloads.start('cs')])
  expect(start).toHaveBeenCalledTimes(1)
  expect(start).toHaveBeenCalledWith('cs', 'hf_x')
  await waitFor(() => expect(downloads.outcome('cs')).toBe('done'))
  expect(seen).toEqual([0, 25, 50, 75, 100, null])
  expect(downloads.download('cs')).toBeNull()
})

test('a failed download says so, and a new one starts over', async () => {
  const client = createFixtureClient({ downloadStepMs: 1, downloadFails: 'no_access' })
  const downloads = createModelDownloads(client, noToken)
  await downloads.start('cs')
  await waitFor(() => expect(downloads.outcome('cs')).toBe('failed'))
  expect(downloads.failure('cs')).toBe('no_access')
  void downloads.start('cs')
  expect(downloads.outcome('cs')).toBeUndefined()
  expect(downloads.failure('cs')).toBeUndefined()
  expect(downloads.download('cs')).toEqual({ pct: 0 })
})

test('a backend that refuses to start is a failure', async () => {
  const client = createFixtureClient({ overrides: { startModelDownload: () => Promise.reject(new Error('down')) } })
  const downloads = createModelDownloads(client, noToken)
  await downloads.start('cs')
  expect(downloads.outcome('cs')).toBe('failed')
  expect(downloads.failure('cs')).toBe('failed')
})

test('an error without a code, such as a lost connection, is failed', async () => {
  const client = createFixtureClient({ overrides: { watchModelDownload: (_job, listener) => {
    setTimeout(() => listener({ type: 'error', message: 'The connection to the backend was lost.' }), 0)
    return () => {}
  } } })
  const downloads = createModelDownloads(client, noToken)
  await downloads.start('cs')
  await waitFor(() => expect(downloads.failure('cs')).toBe('failed'))
})

test('Cancel stops the job on the backend and ends as cancelled', async () => {
  const client = createFixtureClient({ downloadStepMs: 1000 })
  const cancel = vi.spyOn(client, 'cancelModelDownload')
  const downloads = createModelDownloads(client, noToken)
  await downloads.start('cs')
  await downloads.cancel('cs')
  expect(cancel).toHaveBeenCalledWith('cs', expect.any(String))
  expect(downloads.outcome('cs')).toBe('cancelled')
  expect(downloads.download('cs')).toBeNull()
})

test('a cancel before the backend answered stops the job it then answers', async () => {
  const client = createFixtureClient({ downloadStepMs: 1000 })
  let answer: (jobId: string) => void = () => {}
  client.startModelDownload = () => new Promise(resolve => { answer = resolve })
  const cancel = vi.spyOn(client, 'cancelModelDownload').mockResolvedValue()
  const downloads = createModelDownloads(client, noToken)
  const started = downloads.start('cs')
  await downloads.cancel('cs')
  expect(downloads.outcome('cs')).toBe('cancelled')
  await vi.waitFor(() => answer('late'))
  await started
  expect(cancel).toHaveBeenCalledWith('cs', 'late')
})

test('a download that ends done without the model installed failed', async () => {
  const client = createFixtureClient({ overrides: {
    watchModelDownload: (_job, listener) => {
      setTimeout(() => listener({ type: 'done' }), 0)
      return () => {}
    },
    listModels: async () => [{ id: 'cs', kind: 'alignment', installed: false }],
  } })
  const downloads = createModelDownloads(client, noToken)
  await downloads.start('cs')
  await waitFor(() => expect(downloads.outcome('cs')).toBe('failed'))
  expect(downloads.failure('cs')).toBe('failed')
  expect(downloads.download('cs')).toBeNull()
})

test('a download that ends done is failed when the catalog cannot be read', async () => {
  const client = createFixtureClient({ overrides: {
    watchModelDownload: (_job, listener) => {
      setTimeout(() => listener({ type: 'done' }), 0)
      return () => {}
    },
    listModels: () => Promise.reject(new Error('down')),
  } })
  const downloads = createModelDownloads(client, noToken)
  await downloads.start('cs')
  await waitFor(() => expect(downloads.outcome('cs')).toBe('failed'))
})

test('Download, Cancel and Download again before the backend answered keeps the second download', async () => {
  const client = createFixtureClient({ downloadStepMs: 1000 })
  const answers: ((jobId: string) => void)[] = []
  client.startModelDownload = () => new Promise(resolve => { answers.push(resolve) })
  const cancel = vi.spyOn(client, 'cancelModelDownload').mockResolvedValue()
  const downloads = createModelDownloads(client, noToken)
  const first = downloads.start('cs')
  await downloads.cancel('cs')
  const second = downloads.start('cs')
  // The backend gives both the same job: the first one was never cancelled there.
  await vi.waitFor(() => expect(answers).toHaveLength(2))
  answers.forEach(answer => answer('same'))
  await Promise.all([first, second])
  expect(cancel).not.toHaveBeenCalled()
  expect(downloads.download('cs')).toEqual({ pct: 0 })
})

test('the hook shares the downloads of one client, and a finished download reads the catalog again', async () => {
  const client = createFixtureClient({ downloadStepMs: 1 })
  const wrapper = ({ children }: { children: ReactNode }) => <ApiProvider client={client}>{children}</ApiProvider>
  const { result } = renderHook(() => ({ a: useModelDownloads(), b: useModelDownloads(), models: useModels() }), { wrapper })
  expect(result.current.a).toBe(result.current.b)
  await waitFor(() => expect(result.current.models.data).toBeDefined())
  await act(() => result.current.a.start('cs'))
  await waitFor(() => expect(result.current.models.data?.find(m => m.id === 'cs')?.installed).toBe(true))
})
