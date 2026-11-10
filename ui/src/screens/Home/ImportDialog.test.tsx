import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiError } from '../../api/client'
import { createFixtureClient, NO_MODELS } from '../../api/fixtures/fixture-client'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import {
  chooseFiles, drag, field, importButton, importDialog, importDialogUnder, jobs, listed, openImport, option, recordDialog,
  recordingControl, rename, setup,
} from './new-transcription.test-utils'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

describe('opening', () => {
  test('files dragged over the window open it, and it goes when they leave undropped', async () => {
    await setup()
    drag('dragenter')
    const dialog = await screen.findByRole('dialog', { name: 'Import files' })
    // Over the window but not over the zone: the zone stays as it is.
    expect(within(dialog).getByText('Drop audio or video files here')).toBeTruthy()
    expect(recordDialog()).toBeNull()
    drag('dragleave')
    await waitFor(() => expect(importDialog()).toBeNull())
  })

  test('it has no subtitle, no title field, no Diarize speakers and nothing of a recording', async () => {
    await setup()
    const dialog = await openImport()
    expect(within(dialog).queryByText('Make sure all participants have agreed to be recorded.')).toBeNull()
    expect(within(dialog).queryByRole('textbox', { name: 'Title' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Diarize speakers' })).toBeNull()
    expect(within(dialog).queryByRole('group', { name: 'Record' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Start recording' })).toBeNull()
  })

  test('opened from New recording, a drag that leaves does not close it', async () => {
    await setup()
    await openImport()
    drag('dragenter')
    drag('dragleave')
    expect(importDialog()).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(importDialog()).toBeNull())
  })

  test('a drag of text opens nothing', async () => {
    await setup()
    drag('dragenter', { types: ['text/plain'] })
    expect(importDialog()).toBeNull()
  })

  test('opens again on the next drag after a drop', async () => {
    await setup()
    drag('dragenter')
    drag('drop')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(importDialog()).toBeNull())
    drag('dragenter')
    expect(await screen.findByRole('dialog', { name: 'Import files' })).toBeTruthy()
  })
})

describe('over other windows', () => {
  test('files dragged over another window do not open it; their drop is taken and adds nothing', async () => {
    await setup({}, { other: true })
    await screen.findByRole('dialog', { name: 'Other window' })
    drag('dragenter')
    expect(importDialog()).toBeNull()
    const event = drag('drop', { files: ['a.mp3', 'notes.txt'] })
    // Taken, or the window would open the file.
    expect(event.defaultPrevented).toBe(true)
    expect(importDialog()).toBeNull()
    expect(screen.queryByText(/was not imported/)).toBeNull()
  })

  test('Settings open over it, a drop adds nothing; closed, the dialog is back with its files', async () => {
    await setup({ overrides: { addQueueJob: () => Promise.reject(new ApiError(400, NO_MODELS, 'whisper_model_missing')) } }, { chosen: ['/in/a.mp3'] })
    await openImport()
    await chooseFiles()
    await rename('a.mp3', 'Standup')
    await userEvent.click(importButton())
    await userEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Open Settings' }))
    expect(within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('tab', { name: 'Models', selected: true })).toBeTruthy()
    expect(importDialogUnder()).toBeTruthy()
    drag('dragenter')
    expect(drag('drop', { files: ['b.mp3'] }).defaultPrevented).toBe(true)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull())
    expect(importDialog()).toBeTruthy()
    expect(listed()).toEqual(['Standup.mp3'])
  })
})

describe('the files', () => {
  test('a drop anywhere lists the audio, names the rest in a toast, and the dialog stays', async () => {
    await setup()
    drag('dragenter')
    const event = drag('drop', { files: ['Team call.m4a', 'notes.txt', 'b.WAV'] })
    expect(event.defaultPrevented).toBe(true)
    expect(listed()).toEqual(['Team call.m4a', 'b.WAV'])
    expect(await screen.findByText('notes.txt was not imported: this file type is not supported.')).toBeTruthy()
    drag('dragleave')
    expect(importDialog()).toBeTruthy()
  })

  test('a drop with no audio says so in a toast, and the dialog stays empty', async () => {
    await setup()
    drag('dragenter')
    drag('drop', { files: ['a.txt', 'b.pdf'] })
    expect(await screen.findByText('2 files were not imported: these file types are not supported.')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Files to import' })).toBeNull()
    expect(importDialog()).toBeTruthy()
    expect(importButton().disabled).toBe(true)
  })

  test('removing a file clears the refusal shown', async () => {
    await setup({ overrides: { addQueueJob: () => Promise.reject(new ApiError(400, '"b.mp3" could not be read.', 'audio_not_readable')) } }, { chosen: ['/in/a.mp3', '/in/b.mp3'] })
    await openImport()
    await chooseFiles()
    await userEvent.click(importButton())
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Remove b.mp3' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('while the files go to the queue, no more can be added', async () => {
    let release = () => {}
    const add = createFixtureClient().addQueueJob
    await setup({ overrides: { addQueueJob: job => new Promise(resolve => { release = () => resolve(add(job)) }) } }, { chosen: ['/in/a.mp3'] })
    await openImport()
    await chooseFiles()
    await userEvent.click(importButton())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose files' })).toHaveProperty('disabled', true))
    drag('dragenter')
    expect(drag('drop', { files: ['b.mp3'] }).defaultPrevented).toBe(true)
    expect(listed()).toEqual(['a.mp3'])
    expect(screen.getByText('Drop audio or video files here')).toBeTruthy()
    await act(async () => release())
    await waitFor(() => expect(importDialog()).toBeNull())
  })

  test('chosen files join the list, and one can be removed', async () => {
    await setup({}, { chosen: ['/in/a.mp3', '/in/b.mp3'] })
    await openImport()
    await chooseFiles()
    expect(listed()).toEqual(['a.mp3', 'b.mp3'])
    await userEvent.click(screen.getByRole('button', { name: 'Remove a.mp3' }))
    expect(listed()).toEqual(['b.mp3'])
  })
})

describe('importing', () => {
  test('queues the files in order, closes and says so', async () => {
    const client = await setup({}, { chosen: ['/in/b.mp3', '/in/a.mp3'] })
    await openImport()
    await chooseFiles()
    await userEvent.click(importButton())
    await waitFor(() => expect(importDialog()).toBeNull())
    expect(recordDialog()).toBeNull()
    expect(await screen.findByText('Importing 2 files…')).toBeTruthy()
    expect((await client.getQueue()).jobs.map(job => job.audio_path)).toEqual(['/in/b.mp3', '/in/a.mp3'])
  })

  test('one file is named', async () => {
    await setup({}, { chosen: ['/in/Team call.m4a'] })
    await openImport()
    await chooseFiles()
    await userEvent.click(importButton())
    expect(await screen.findByText('Importing Team call.m4a…')).toBeTruthy()
  })

  test('a model refused by the backend shows in the dialog, with a way to Settings', async () => {
    // The catalog said it was there; it went before the job did.
    await setup({ overrides: { addQueueJob: () => Promise.reject(new ApiError(400, NO_MODELS, 'diarization_model_missing')) } }, { chosen: ['/in/a.mp3'] })
    await openImport()
    await chooseFiles()
    await userEvent.click(importButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(NO_MODELS)
    // No icon: the words say what is wrong.
    expect(alert.querySelector('svg:not(button svg)')).toBeNull()
    expect(importDialog()).toBeTruthy()
    expect(listed()).toEqual(['a.mp3'])
    await userEvent.click(within(alert).getByRole('button', { name: 'Open Settings' }))
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy()
  })

  test('a backend that does not answer is said in the dialog, with no link to Settings', async () => {
    await setup({ overrides: { addQueueJob: () => Promise.reject(new ApiError(0, 'Failed to fetch')) } }, { chosen: ['/in/a.mp3'] })
    await openImport()
    await chooseFiles()
    await userEvent.click(importButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent!.trim()).toBe('The backend is not responding.')
    expect(within(alert).queryByRole('button', { name: 'Open Settings' })).toBeNull()
  })

  test('files queued before a refusal leave the list, so they are not sent twice', async () => {
    const add = createFixtureClient().addQueueJob
    await setup({ overrides: { addQueueJob: job => (job.audioPath === '/in/b.mp3' ? Promise.reject(new ApiError(400, '"b.mp3" could not be read.', 'audio_not_readable')) : add(job)) } }, { chosen: ['/in/a.mp3', '/in/b.mp3'] })
    await openImport()
    await chooseFiles()
    await userEvent.click(importButton())
    expect((await screen.findByRole('alert')).textContent!.trim()).toBe('"b.mp3" could not be read.')
    expect(listed()).toEqual(['b.mp3'])
    expect(await screen.findByText('Importing a.mp3…')).toBeTruthy()
  })

  test('while a recording runs, files are imported as always', async () => {
    const client = await setup({}, { chosen: ['/in/a.mp3'] })
    act(() => recordingControl.start({ mic: false, micDeviceId: null, system: true, systemSourceId: '@DEFAULT_MONITOR@', title: 'Live', model: null, language: null }))
    await waitFor(() => expect(recordingControl.phase).toBe('live'))
    drag('dragenter')
    const dialog = await screen.findByRole('dialog', { name: 'Import files' })
    expect(within(dialog).queryByText(/A recording is already in progress/)).toBeNull()
    drag('dragleave')
    await waitFor(() => expect(importDialog()).toBeNull())
    await openImport()
    await chooseFiles()
    await userEvent.click(importButton())
    await waitFor(async () => expect((await client.getQueue()).jobs.map(job => job.title)).toEqual(['a']))
  })
})

describe('title, model and language', () => {
  test('a file renamed in the list goes with its title, trimmed; its extension stays', async () => {
    const client = await setup({}, { chosen: ['/in/a.mp3', '/in/Team call.m4a'] })
    await openImport()
    await chooseFiles()
    await userEvent.click(screen.getByRole('button', { name: 'Rename Team call.m4a' }))
    const title = screen.getByRole('textbox', { name: 'Title of Team call.m4a' }) as HTMLInputElement
    // Only the name: the extension stands after the field and cannot be changed.
    expect(title.value).toBe('Team call')
    await userEvent.clear(title)
    await userEvent.type(title, '  Weekly sync {Enter}')
    expect(listed()).toEqual(['a.mp3', 'Weekly sync.m4a'])
    await userEvent.click(importButton())
    await waitFor(async () => expect((await jobs(client)).map(job => job.title)).toEqual(['a', 'Weekly sync']))
  })

  test('Escape keeps the name it had, and a blank name gives the file its own again', async () => {
    await setup({}, { chosen: ['/in/a.mp3'] })
    await openImport()
    await chooseFiles()
    await rename('a.mp3', 'Retro')
    await userEvent.click(screen.getByRole('button', { name: 'Rename a.mp3' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Title of a.mp3' }), ' 2{Escape}')
    expect(listed()).toEqual(['Retro.mp3'])
    // Escape ends the rename, not the dialog.
    expect(importDialog()).toBeTruthy()
    await rename('a.mp3', '   ')
    expect(listed()).toEqual(['a.mp3'])
  })

  test('files not renamed are each named after their file', async () => {
    const client = await setup({}, { chosen: ['/in/b.mp3', '/in/a.wav'] })
    await openImport()
    await chooseFiles()
    await userEvent.click(importButton())
    await waitFor(async () => expect((await jobs(client)).map(job => job.title)).toEqual(['b', 'a']))
  })

  test('the files come before the zone, and what is wrong comes last', async () => {
    await setup({ noModels: true }, { chosen: ['/in/a.mp3'] })
    const dialog = await openImport()
    await chooseFiles()
    const list = within(dialog).getByRole('list', { name: 'Files to import' })
    const zone = within(dialog).getByText('Drop audio or video files here')
    const notice = within(dialog).getByRole('status')
    const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(before(field('Language'), list)).toBe(true)
    expect(before(list, zone)).toBe(true)
    expect(before(zone, notice)).toBe(true)
  })

  test('model and language start from the defaults; a choice here is for this import and is not saved', async () => {
    const client = await setup({}, { chosen: ['/in/a.mp3'], settings: { transcribeModel: 'small', transcribeModelHistory: ['small'], transcribeLang: 'de' } })
    drag('dragenter')
    drag('drop', { files: [] })
    await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Small'))
    expect(field('Language').textContent?.trim()).toBe('Deutsch')
    await userEvent.click(field('Model'))
    await userEvent.click(option(/Whisper Large v3/))
    await userEvent.click(field('Language'))
    await userEvent.click(option(/English/))
    await chooseFiles()
    await userEvent.click(importButton())
    await waitFor(async () => expect(await jobs(client)).toEqual([{ title: 'a', model: 'large-v3', language: 'en' }]))
    expect(await window.electronAPI!.readSettings()).toMatchObject({ transcribeModel: 'small', transcribeLang: 'de' })
  })

  test('the next opening starts from the defaults again', async () => {
    await setup({}, { settings: { transcribeModel: 'small', transcribeLang: 'auto' } })
    await openImport()
    await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Small'))
    await userEvent.click(field('Model'))
    await userEvent.click(option(/Whisper Large v3/))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(importDialog()).toBeNull())
    drag('dragenter')
    await screen.findByRole('dialog', { name: 'Import files' })
    await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Small'))
  })

  test('a saved default that is not downloaded is not used', async () => {
    const client = await setup({ installedModels: ['small', 'diarize'] }, { chosen: ['/in/a.mp3'], settings: { transcribeModel: 'large-v3' } })
    await openImport()
    await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Small'))
    await chooseFiles()
    await userEvent.click(importButton())
    await waitFor(async () => expect((await jobs(client))[0]?.model).toBe('small'))
  })

  test('until the settings are read, it waits with Import off and shows no default', async () => {
    await setup({}, { chosen: ['/in/a.mp3'], bridge: { readSettings: () => new Promise(() => {}) } })
    drag('dragenter')
    await screen.findByRole('dialog', { name: 'Import files' })
    await chooseFiles()
    expect(field('Model').textContent?.trim()).toBe('Checking models…')
    expect(field('Language').textContent?.trim()).toBe('Checking…')
    expect(importButton().disabled).toBe(true)
  })

  test('until the models are known, it opens and waits with Import off', async () => {
    await setup({ overrides: { listModels: () => new Promise(() => {}) } }, { chosen: ['/in/a.mp3'] })
    await openImport()
    expect(field('Model').textContent?.trim()).toBe('Checking models…')
    await chooseFiles()
    expect(importButton().disabled).toBe(true)
  })

  test.each([
    [{ noModels: true }, 'auto', 'No transcription model installed'],
    [{ installedModels: ['small'] }, 'auto', 'Diarization model not installed'],
    [{}, 'ru', 'Alignment model for Русский is not installed'],
  ])('without a model a job needs it says which, with a way to Settings, and Import is off (%o, %s)', async (options, language, message) => {
    const client = await setup(options, { chosen: ['/in/a.mp3'], settings: { transcribeLang: language } })
    await openImport()
    const notice = await screen.findByRole('status')
    expect(notice.textContent).toContain(message)
    await chooseFiles()
    expect(listed()).toEqual(['a.mp3'])
    expect(importButton().disabled).toBe(true)
    expect((await client.getQueue()).jobs).toEqual([])
    expect(within(notice).getByRole('button', { name: 'Download in Settings' })).toBeTruthy()
  })

  test('Download in Settings opens Settings over the dialog, which stays', async () => {
    await setup({ noModels: true })
    await openImport()
    await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Download in Settings' }))
    expect(within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('tab', { name: 'Models', selected: true })).toBeTruthy()
    expect(importDialogUnder()).toBeTruthy()
  })

  test('a language whose alignment model is not downloaded is off; picking Detect lets the import go', async () => {
    const client = await setup({}, { chosen: ['/in/a.mp3'], settings: { transcribeLang: 'ru' } })
    await openImport()
    await screen.findByRole('status')
    await userEvent.click(field('Language'))
    expect(option(/Русский/).getAttribute('aria-disabled')).toBe('true')
    expect(option(/English/).getAttribute('aria-disabled')).toBeNull()
    await userEvent.click(option(/Detect automatically/))
    expect(screen.queryByRole('status')).toBeNull()
    await chooseFiles()
    await userEvent.click(importButton())
    await waitFor(async () => expect((await jobs(client))[0]?.language).toBeNull())
  })
})
