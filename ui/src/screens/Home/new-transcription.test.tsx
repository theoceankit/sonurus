import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import {
  chooseFiles, drag, field, importButton, importDialog, jobs, listed, openRecording, option, recordDialog, recordDialogUnder, setup,
} from './new-transcription.test-utils'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

const title = () => screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement
const toggle = (name: string) => screen.getByRole('button', { name })

// Picks Large v3, English and a title in New recording.
async function pickInRecording() {
  await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Small'))
  await userEvent.click(field('Model'))
  await userEvent.click(option(/Whisper Large v3/))
  await userEvent.click(field('Language'))
  await userEvent.click(option(/English/))
  await userEvent.type(title(), 'Standup')
}

const SETTINGS = { settings: { transcribeModel: 'small', transcribeModelHistory: ['small'], transcribeLang: 'de' } }

describe('Import files in New recording', () => {
  test('takes its place, with the title, model and language picked there', async () => {
    const client = await setup({}, { ...SETTINGS, chosen: ['/in/a.mp3', '/in/b.mp3'] })
    await openRecording()
    await pickInRecording()
    await userEvent.click(screen.getByRole('button', { name: 'Import files' }))
    const dialog = await screen.findByRole('dialog', { name: 'Import files' })
    await waitFor(() => expect(recordDialog()).toBeNull())
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(field('Model').textContent?.trim()).toBe('Whisper Large v3')
    expect(field('Language').textContent?.trim()).toBe('English')
    // The title typed there goes to the first file added.
    await chooseFiles()
    expect(listed()).toEqual(['Standup.mp3', 'b.mp3'])
    await userEvent.click(importButton())
    await waitFor(async () => expect(await jobs(client)).toEqual([
      { title: 'Standup', model: 'large-v3', language: 'en' },
      { title: 'b', model: 'large-v3', language: 'en' },
    ]))
  })

  test('closed, the next New recording starts afresh', async () => {
    await setup({}, SETTINGS)
    await openRecording()
    await pickInRecording()
    await userEvent.click(screen.getByRole('button', { name: 'Import files' }))
    await screen.findByRole('dialog', { name: 'Import files' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(importDialog()).toBeNull())
    expect(recordDialog()).toBeNull()
    await openRecording()
    await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Small'))
    expect(title().value).toBe('')
  })
})

describe('files dragged over New recording', () => {
  test('switch it to Import files with what was picked; leaving undropped brings it back as it was', async () => {
    await setup({}, { ...SETTINGS, settings: { ...SETTINGS.settings, recordingAudioSource: 'both' } })
    await openRecording()
    await pickInRecording()
    await waitFor(() => expect(toggle('Microphone').getAttribute('aria-pressed')).toBe('true'))
    await userEvent.click(toggle('Microphone'))
    drag('dragenter')
    await screen.findByRole('dialog', { name: 'Import files' })
    expect(field('Model').textContent?.trim()).toBe('Whisper Large v3')
    drag('dragleave')
    await screen.findByRole('dialog', { name: 'New recording' })
    await waitFor(() => expect(importDialog()).toBeNull())
    expect(title().value).toBe('Standup')
    expect(field('Model').textContent?.trim()).toBe('Whisper Large v3')
    expect(field('Language').textContent?.trim()).toBe('English')
    expect(toggle('Microphone').getAttribute('aria-pressed')).toBe('false')
    expect(toggle('System audio').getAttribute('aria-pressed')).toBe('true')
  })

  test('dropped, Import files stays with them, the first named as New recording was', async () => {
    await setup()
    await openRecording()
    await userEvent.type(title(), 'Standup')
    drag('dragenter')
    await screen.findByRole('dialog', { name: 'Import files' })
    drag('drop', { files: ['a.mp3', 'b.mp3'] })
    drag('dragenter')
    drag('dragleave')
    expect(importDialog()).toBeTruthy()
    expect(recordDialog()).toBeNull()
    expect(listed()).toEqual(['Standup.mp3', 'b.mp3'])
  })

  test('under Settings, nothing changes and the drop adds nothing', async () => {
    await setup({ noModels: true })
    await openRecording()
    await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Download in Settings' }))
    await screen.findByRole('dialog', { name: 'Settings' })
    drag('dragenter')
    expect(drag('drop', { files: ['a.mp3'] }).defaultPrevented).toBe(true)
    expect(importDialog()).toBeNull()
    expect(recordDialogUnder()).toBeTruthy()
  })
})
