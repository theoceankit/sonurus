import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { createFixtureClient, NO_MODELS, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { NOT_IMPLEMENTED_TOAST } from '../../not-implemented'
import { OverlayProvider } from '../../OverlayProvider'
import { createMockElectronAPI } from '../../platform/electron-api-mock'
import { EditorScreen } from '../Editor/EditorScreen'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

function setup(options: FixtureOptions = {}, chosen: string[] = []) {
  const client = createFixtureClient(options)
  vi.stubGlobal('electronAPI', createMockElectronAPI({ openFiles: async () => chosen }))
  render(<ApiProvider client={client}><OverlayProvider><EditorScreen /></OverlayProvider></ApiProvider>)
  return client
}

// jsdom has no DragEvent or DataTransfer.
function drag(type: string, { files = ['a.mp3'], types = ['Files'] } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { types, files: files.map(name => new File([], name)), dropEffect: 'none' } })
  act(() => { document.body.dispatchEvent(event) })
  return event
}

const dialog = () => screen.queryByRole('dialog', { name: 'New transcription' })
const listed = () => within(screen.getByRole('list', { name: 'Files to import' })).getAllByRole('listitem').map(item => item.textContent!.trim())
const openByButton = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'New transcription' }))
  return screen.findByRole('dialog', { name: 'New transcription' })
}

describe('opening', () => {
  test('the plus opens it, and a drag that leaves does not close it', async () => {
    setup()
    await openByButton()
    drag('dragenter')
    drag('dragleave')
    expect(dialog()).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(dialog()).toBeNull())
  })

  test('files dragged over the window open it, and it goes when they leave undropped', async () => {
    setup()
    await screen.findByRole('button', { name: 'New transcription' })
    drag('dragenter')
    expect(await screen.findByRole('dialog', { name: 'New transcription' })).toBeTruthy()
    // Over the window but not over the zone: the zone stays as it is.
    expect(screen.getByText('Drop audio or video files here')).toBeTruthy()
    drag('dragleave')
    await waitFor(() => expect(dialog()).toBeNull())
  })

  test('a drag of text opens nothing', async () => {
    setup()
    await screen.findByRole('button', { name: 'New transcription' })
    drag('dragenter', { types: ['text/plain'] })
    expect(dialog()).toBeNull()
  })

  test('opens again on the next drag after a drop', async () => {
    setup()
    await screen.findByRole('button', { name: 'New transcription' })
    drag('dragenter')
    drag('drop')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(dialog()).toBeNull())
    drag('dragenter')
    expect(await screen.findByRole('dialog', { name: 'New transcription' })).toBeTruthy()
  })
})

describe('the files', () => {
  test('a drop anywhere lists the audio, names the rest in a toast, and the dialog stays', async () => {
    setup()
    await screen.findByRole('button', { name: 'New transcription' })
    drag('dragenter')
    const event = drag('drop', { files: ['Team call.m4a', 'notes.txt', 'b.WAV'] })
    expect(event.defaultPrevented).toBe(true)
    expect(listed()).toEqual(['Team call.m4a', 'b.WAV'])
    expect(await screen.findByText('notes.txt was not imported: this file type is not supported.')).toBeTruthy()
    drag('dragleave')
    expect(dialog()).toBeTruthy()
  })

  test('a drop with no audio says so in a toast, and the dialog stays empty', async () => {
    setup()
    await screen.findByRole('button', { name: 'New transcription' })
    drag('dragenter')
    drag('drop', { files: ['a.txt', 'b.pdf'] })
    expect(await screen.findByText('2 files were not imported: these file types are not supported.')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Files to import' })).toBeNull()
    expect(dialog()).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('chosen files join the list, and one can be removed', async () => {
    setup({}, ['/in/a.mp3', '/in/b.mp3'])
    await openByButton()
    await userEvent.click(screen.getByRole('button', { name: 'Choose files' }))
    expect(listed()).toEqual(['a.mp3', 'b.mp3'])
    await userEvent.click(screen.getByRole('button', { name: 'Remove a.mp3' }))
    expect(listed()).toEqual(['b.mp3'])
  })
})

describe('importing', () => {
  test('queues the files in order, closes and says so', async () => {
    const client = setup({}, ['/in/b.mp3', '/in/a.mp3'])
    await openByButton()
    await userEvent.click(screen.getByRole('button', { name: 'Choose files' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(dialog()).toBeNull())
    expect(await screen.findByText('Importing 2 files…')).toBeTruthy()
    expect((await client.getQueue()).jobs.map(job => job.audio_path)).toEqual(['/in/b.mp3', '/in/a.mp3'])
  })

  test('one file is named', async () => {
    setup({}, ['/in/Team call.m4a'])
    await openByButton()
    await userEvent.click(screen.getByRole('button', { name: 'Choose files' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByText('Importing Team call.m4a…')).toBeTruthy()
  })

  test('without models the refusal shows in the dialog, with Settings not there yet', async () => {
    setup({ noModels: true }, ['/in/a.mp3'])
    await openByButton()
    await userEvent.click(screen.getByRole('button', { name: 'Choose files' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(NO_MODELS)
    expect(dialog()).toBeTruthy()
    expect(listed()).toEqual(['a.mp3'])
    const settings = within(alert).getByRole('button', { name: 'Open Settings' })
    expect(settings.getAttribute('data-not-implemented')).toBe('import.open-settings')
    await userEvent.click(settings)
    expect((await screen.findAllByText(NOT_IMPLEMENTED_TOAST)).length).toBeGreaterThan(0)
  })

  test('a backend that does not answer is said in the dialog, with no link to Settings', async () => {
    setup({ overrides: { addQueueJob: () => Promise.reject(new ApiError(0, 'Failed to fetch')) } }, ['/in/a.mp3'])
    await openByButton()
    await userEvent.click(screen.getByRole('button', { name: 'Choose files' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent!.trim()).toBe('The backend is not responding.')
    expect(within(alert).queryByRole('button', { name: 'Open Settings' })).toBeNull()
  })

  test('files queued before a refusal leave the list, so they are not sent twice', async () => {
    const client = createFixtureClient()
    const add = client.addQueueJob
    setup({ overrides: { addQueueJob: job => (job.audioPath === '/in/b.mp3' ? Promise.reject(new ApiError(400, 'audio_path not readable: /in/b.mp3')) : add(job)) } }, ['/in/a.mp3', '/in/b.mp3'])
    await openByButton()
    await userEvent.click(screen.getByRole('button', { name: 'Choose files' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect((await screen.findByRole('alert')).textContent!.trim()).toBe('audio_path not readable: /in/b.mp3')
    expect(listed()).toEqual(['b.mp3'])
    expect(await screen.findByText('Importing a.mp3…')).toBeTruthy()
  })
})

test('an error says what is wrong with no icon', async () => {
  setup({ noModels: true }, ['/in/a.mp3'])
  await openByButton()
  await userEvent.click(screen.getByRole('button', { name: 'Choose files' }))
  await userEvent.click(screen.getByRole('button', { name: 'Import' }))
  expect((await screen.findByRole('alert')).querySelector('svg:not(button svg)')).toBeNull()
})
