import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { QUEUE_JOB, queueSnapshot } from '../../api/fixtures/data'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import type { QueueJob } from '../../api/types'
import { OverlayProvider } from '../../OverlayProvider'
import { EditJobDialog } from './EditJobDialog'

const JOB: QueueJob = { ...QUEUE_JOB, id: 'j1', title: 'Weekly sync', whisper_model: 'small', language: null, status: 'waiting' }

function Harness({ job }: { job: QueueJob }) {
  const [editing, setEditing] = useState<QueueJob | null>(job)
  return <EditJobDialog job={editing} onClose={() => setEditing(null)} />
}

async function setup(options: FixtureOptions = {}, job = JOB) {
  const client = createFixtureClient(options)
  client.playEvents({ steps: [{ afterMs: 0, event: queueSnapshot({ jobs: [job] }) }] })
  await vi.waitFor(async () => expect((await client.getQueue()).jobs).toHaveLength(1))
  const update = vi.spyOn(client, 'updateQueueJob')
  render(<ApiProvider client={client}><OverlayProvider><Harness job={job} /></OverlayProvider></ApiProvider>)
  await screen.findByRole('dialog', { name: 'Transcription settings' })
  return { client, update }
}

const title = () => screen.getByRole('textbox', { name: 'Title' })
const save = () => screen.getByRole('button', { name: 'Save' })
const dialog = () => screen.queryByRole('dialog', { name: 'Transcription settings' })
const field = (name: string) => screen.getByRole('button', { name })
const option = (name: RegExp) => screen.getByRole('menuitemradio', { name })

test('starts with the job as it is, the title focused', async () => {
  await setup()
  expect((title() as HTMLInputElement).value).toBe('Weekly sync')
  expect(document.activeElement).toBe(title())
  await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Small'))
  expect(field('Language').textContent?.trim()).toBe('Detect automatically')
})

test('only the changed fields are sent, then it closes', async () => {
  const { client, update } = await setup()
  await userEvent.clear(title())
  await userEvent.type(title(), ' Standup ')
  await userEvent.click(field('Language'))
  await userEvent.click(option(/English/))
  await userEvent.click(save())
  await waitFor(() => expect(dialog()).toBeNull())
  expect(update).toHaveBeenCalledWith('j1', { title: 'Standup', language: 'en' })
  expect((await client.getQueue()).jobs[0]).toMatchObject({ title: 'Standup', language: 'en', whisper_model: 'small' })
})

test('nothing changed closes without a request', async () => {
  const { update } = await setup()
  await userEvent.click(save())
  await waitFor(() => expect(dialog()).toBeNull())
  expect(update).not.toHaveBeenCalled()
})

test('a blank title is an error in the dialog, gone on the next key', async () => {
  const { update } = await setup()
  await userEvent.clear(title())
  await userEvent.click(save())
  expect(screen.getByText('Title cannot be empty.')).toBeTruthy()
  expect(update).not.toHaveBeenCalled()
  await userEvent.type(title(), 'S')
  expect(screen.queryByText('Title cannot be empty.')).toBeNull()
})

test('a refusal keeps the dialog open with the reason', async () => {
  await setup({ overrides: { updateQueueJob: () => Promise.reject(new ApiError(409, 'The job is running; pause the queue to edit it')) } })
  await userEvent.type(title(), '!')
  await userEvent.click(save())
  expect(await screen.findByText('The job is running; pause the queue to edit it')).toBeTruthy()
  expect(dialog()).toBeTruthy()
})

test('Enter in the title saves, Escape closes without saving', async () => {
  const first = await setup()
  await userEvent.type(title(), ' 2{Enter}')
  await waitFor(() => expect(dialog()).toBeNull())
  expect(first.update).toHaveBeenCalledWith('j1', { title: 'Weekly sync 2' })
})

test('Escape closes without saving', async () => {
  const { update } = await setup()
  await userEvent.type(title(), ' 2')
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(dialog()).toBeNull())
  expect(update).not.toHaveBeenCalled()
})

test('models not downloaded are off; the job keeps its own model when it is gone', async () => {
  await setup({}, { ...JOB, whisper_model: 'medium' })
  await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Medium'))
  await userEvent.click(field('Model'))
  const menu = screen.getByRole('menu')
  expect(within(menu).getByRole('menuitemradio', { name: /Whisper Medium/ }).getAttribute('aria-disabled')).toBe('true')
  expect(within(menu).getByRole('menuitemradio', { name: /Whisper Large v3/ }).getAttribute('aria-disabled')).toBeNull()
})
