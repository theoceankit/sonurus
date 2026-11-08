import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { QUEUE_JOB, queueSnapshot } from '../../api/fixtures/data'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { useQueueEventsSync } from '../../api/queries'
import type { QueueJob, QueueSnapshot } from '../../api/types'
import { Toaster } from '../../components/Toast/Toast'
import { OverlayProvider } from '../../OverlayProvider'
import { JOB_DRAG_TYPE, QueueSection } from './QueueSection'

const job = (id: string, changes: Partial<QueueJob> = {}): QueueJob => ({
  ...QUEUE_JOB, id, title: `Job ${id}`, audio_path: `/data/recordings/sonorus-import-${id}.wav`, whisper_model: 'small', ...changes,
})
const QUEUE = queueSnapshot({
  running_job_id: 'a',
  step: 'Transcribing audio…',
  jobs: [job('a', { status: 'running' }), job('b'), job('c', { status: 'failed', error: 'Failed to load audio: invalid data' })],
})

function Synced({ onSelectJob }: { onSelectJob?: (id: string) => void }) {
  useQueueEventsSync()
  return <QueueSection selectedJobId="b" onSelectJob={onSelectJob} />
}

async function setup(snapshot: QueueSnapshot = QUEUE, options: FixtureOptions = {}, onSelectJob?: (id: string) => void) {
  const client = createFixtureClient(options)
  client.playEvents({ steps: [{ afterMs: 0, event: snapshot }] })
  await vi.waitFor(async () => expect((await client.getQueue()).jobs).toHaveLength(snapshot.jobs.length))
  const view = render(<ApiProvider client={client}><OverlayProvider><Synced onSelectJob={onSelectJob} /><Toaster /></OverlayProvider></ApiProvider>)
  if (snapshot.jobs.length) await screen.findByRole('region', { name: 'Transcription queue' })
  return { client, ...view }
}

const queue = () => screen.getByRole('region', { name: 'Transcription queue' })
// The row's own button, and the li around the row and its buttons.
const rowButton = (title: string) => within(queue()).getByRole('button', { name: new RegExp(`(^| )${title}$`) })
const row = (title: string) => rowButton(title).closest('li')!
const rowRoot = (title: string) => rowButton(title).parentElement!
const order = () => within(queue()).getAllByRole('listitem').map(item => item.querySelector('button')!.textContent)
const menu = async (title: string) => {
  await userEvent.click(within(row(title)).getByRole('button', { name: 'More' }))
  return screen.findByRole('menu')
}

test('shows nothing while the queue is empty', async () => {
  const { container } = await setup(queueSnapshot())
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(screen.queryByRole('region', { name: 'Transcription queue' })).toBeNull()
  expect(container.textContent).toBe('')
})

test('a section like those of the list: its title, and Paused only while paused', async () => {
  await setup()
  expect(within(queue()).getByText('Queue')).toBeTruthy()
  expect(within(queue()).queryByText('Paused')).toBeNull()
  expect(within(queue()).queryByRole('button', { name: /Pause|Resume|Start/ })).toBeNull()
})

test('the rows say which job runs, waits or failed; the picked one is current', async () => {
  await setup()
  within(row('Job a')).getByRole('img', { name: 'Transcribing' })
  within(row('Job c')).getByRole('img', { name: 'Failed' })
  within(row('Job b')).getByRole('img', { name: 'Waiting' })
  expect(rowButton('Job b').getAttribute('aria-current')).toBe('true')
})

test('a click on a row picks its job', async () => {
  const onSelectJob = vi.fn()
  await setup(QUEUE, {}, onSelectJob)
  await userEvent.click(rowButton('Job c'))
  expect(onSelectJob).toHaveBeenCalledWith('c')
})

test('a failed row has Retry, which puts the job back at the end, waiting', async () => {
  await setup()
  expect(within(row('Job b')).queryByRole('button', { name: 'Retry' })).toBeNull()
  await userEvent.click(within(row('Job c')).getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(within(row('Job c')).queryByRole('img', { name: 'Failed' })).toBeNull())
})

test('the menu: Pause queue first, then the settings (not for the running job), then Delete', async () => {
  await setup()
  const running = await menu('Job a')
  expect(within(running).getAllByRole('menuitem').map(item => item.textContent?.trim())).toEqual(['Pause queue', 'Delete from queue'])
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  const waiting = await menu('Job b')
  expect(within(waiting).getAllByRole('menuitem').map(item => item.textContent?.trim())).toEqual(['Pause queue', 'Transcription settings', 'Delete from queue'])
})

test('a right click on a row opens the same menu', async () => {
  await setup()
  fireEvent.contextMenu(rowButton('Job b'))
  const opened = await screen.findByRole('menu')
  expect(within(opened).getAllByRole('menuitem').map(item => item.textContent?.trim())).toEqual(['Pause queue', 'Transcription settings', 'Delete from queue'])
  expect(within(row('Job b')).getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('true')
})

test('Pause queue stops the running job and the header says Paused; Resume queue starts it', async () => {
  await setup()
  await userEvent.click(within(await menu('Job b')).getByRole('menuitem', { name: 'Pause queue' }))
  await waitFor(() => expect(within(queue()).getByText('Paused')).toBeTruthy())
  expect(within(row('Job a')).queryByRole('img', { name: 'Transcribing' })).toBeNull()
  await userEvent.click(within(await menu('Job b')).getByRole('menuitem', { name: 'Resume queue' }))
  await waitFor(() => expect(within(queue()).queryByText('Paused')).toBeNull())
})

test('a refusal is a toast with its text, and the queue stays', async () => {
  await setup(QUEUE, { overrides: { pauseQueue: () => Promise.reject(new ApiError(500, 'Queue is busy')) } })
  await userEvent.click(within(await menu('Job b')).getByRole('menuitem', { name: 'Pause queue' }))
  await screen.findAllByText('Queue is busy')
  expect(within(queue()).queryByText('Paused')).toBeNull()
})

test('Transcription settings opens the job settings dialog', async () => {
  await setup()
  await userEvent.click(within(await menu('Job b')).getByRole('menuitem', { name: 'Transcription settings' }))
  const dialog = await screen.findByRole('dialog', { name: 'Transcription settings' })
  expect((within(dialog).getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('Job b')
})

test('Delete from queue asks first; an import keeps the original', async () => {
  const { client } = await setup()
  const remove = vi.spyOn(client, 'deleteQueueJob')
  await userEvent.click(within(await menu('Job b')).getByRole('menuitem', { name: 'Delete from queue' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete "Job b"?' })
  expect(dialog.textContent).toMatch(/original file is kept/)
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' })))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(order()).toEqual(['Job a', 'Job c']))
  expect(remove).toHaveBeenCalledWith('b')
})

test('Cancel keeps the job', async () => {
  const { client } = await setup()
  const remove = vi.spyOn(client, 'deleteQueueJob')
  await userEvent.click(within(await menu('Job b')).getByRole('menuitem', { name: 'Delete from queue' }))
  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(remove).not.toHaveBeenCalled()
})

test('deleting the last job closes the queue and lets the dialog close', async () => {
  await setup(queueSnapshot({ jobs: [job('a')] }))
  await userEvent.click(within(await menu('Job a')).getByRole('menuitem', { name: 'Delete from queue' }))
  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Transcription queue' })).toBeNull())
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
})

test('Alt+Up and Alt+Down move the focused row a step and keep the focus on it', async () => {
  const { client } = await setup()
  const reorder = vi.spyOn(client, 'reorderQueue')
  expect(rowButton('Job c').getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp Alt+ArrowDown')
  rowButton('Job c').focus()
  await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}')
  await waitFor(() => expect(reorder).toHaveBeenLastCalledWith(['a', 'c', 'b']))
  await waitFor(() => expect(order()[1]).toBe('Job c'))
  await waitFor(() => expect(document.activeElement).toBe(rowButton('Job c')))
  await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}')
  await waitFor(() => expect(order()[0]).toBe('Job c'))
  await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}')
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(reorder).toHaveBeenCalledTimes(2)
  await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
  await waitFor(() => expect(order()[1]).toBe('Job c'))
})

test('arrows without Alt, or on a button at the end of the row, do not move it', async () => {
  const { client } = await setup()
  const reorder = vi.spyOn(client, 'reorderQueue')
  rowButton('Job b').focus()
  await userEvent.keyboard('{ArrowUp}')
  within(row('Job b')).getByRole('button', { name: 'More' }).focus()
  await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}')
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(reorder).not.toHaveBeenCalled()
})

// jsdom has no layout and gives drag events no pointer position, so every drop
// lands after the row under it.
const dataTransfer = () => {
  const data = new Map<string, string>()
  return {
    get types() { return [...data.keys()] },
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    effectAllowed: 'all',
    dropEffect: 'none',
  }
}

test('dropping a row after another sends the new order', async () => {
  const { client } = await setup()
  const reorder = vi.spyOn(client, 'reorderQueue')
  const transfer = dataTransfer()
  fireEvent.dragStart(rowRoot('Job a'), { dataTransfer: transfer })
  fireEvent.dragOver(rowRoot('Job c'), { dataTransfer: transfer, clientY: 10 })
  expect(rowRoot('Job c').querySelector('[data-place="after"]')).not.toBeNull()
  fireEvent.drop(rowRoot('Job c'), { dataTransfer: transfer, clientY: 10 })
  fireEvent.dragEnd(rowRoot('Job a'), { dataTransfer: transfer })
  await waitFor(() => expect(reorder).toHaveBeenCalledWith(['b', 'c', 'a']))
  await waitFor(() => expect(order()).toEqual(['Job b', 'Job c', 'Job a']))
})

test('while a row is dragged, new snapshots wait until the drop', async () => {
  const { client } = await setup()
  const transfer = dataTransfer()
  fireEvent.dragStart(rowRoot('Job b'), { dataTransfer: transfer })
  act(() => { client.playEvents({ steps: [{ afterMs: 0, event: { ...QUEUE, jobs: QUEUE.jobs.slice(1) } }] }) })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(order()).toHaveLength(3)
  fireEvent.dragEnd(rowRoot('Job b'), { dataTransfer: transfer })
  await waitFor(() => expect(order()).toHaveLength(2))
})

test('a drag that carries files is not a row\'s', async () => {
  const { client } = await setup()
  const reorder = vi.spyOn(client, 'reorderQueue')
  const files = { types: ['Files'], getData: () => '', dropEffect: 'none' }
  fireEvent.dragOver(rowRoot('Job c'), { dataTransfer: files, clientY: 10 })
  fireEvent.drop(rowRoot('Job c'), { dataTransfer: files, clientY: 10 })
  expect(rowRoot('Job c').querySelector('[data-place]')).toBeNull()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(reorder).not.toHaveBeenCalled()
  expect(JOB_DRAG_TYPE).not.toBe('Files')
})
