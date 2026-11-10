import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { BOTH_OFF, NO_SYSTEM_AUDIO } from '../../recording/sources'
import { field, openRecording, option, recordDialog, recordingControl, setup } from './new-transcription.test-utils'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

const toggle = (name: string) => screen.getByRole('button', { name })
const start = () => screen.getByRole('button', { name: 'Start recording' }) as HTMLButtonElement

describe('what it has', () => {
  test('asks for consent, records and does not take files', async () => {
    await setup()
    const dialog = await openRecording()
    expect(within(dialog).getByText('Make sure all participants have agreed to be recorded.')).toBeTruthy()
    expect(within(dialog).getByRole('group', { name: 'Record' })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Choose files' })).toBeNull()
    expect(within(dialog).queryByText('Drop audio or video files here')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Import' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Import files' })).toBeTruthy()
  })

  test('closes by its cross alone, and has no Diarize speakers', async () => {
    await setup()
    const dialog = await openRecording()
    expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Diarize speakers' })).toBeNull()
    expect(within(dialog).queryAllByRole('switch')).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(recordDialog()).toBeNull())
  })
})

describe('the sources', () => {
  test('start from the sources and devices saved last', async () => {
    await setup({}, { settings: { recordingAudioSource: 'mic', recordingSystemDevice: 'bluez_output.58_18_62_38_72_FA.1.monitor' } })
    await openRecording()
    await waitFor(() => expect(toggle('Microphone').getAttribute('aria-pressed')).toBe('true'))
    expect(toggle('System audio').getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(toggle('System audio device'))
    expect((await screen.findByRole('menuitem', { name: 'WH-1000XM5' })).querySelector('svg:last-child')).toBeTruthy()
  })

  test('with both off, Start is off and says why', async () => {
    await setup({}, { settings: { recordingAudioSource: 'mic' } })
    await openRecording()
    await waitFor(() => expect(toggle('Microphone').getAttribute('aria-pressed')).toBe('true'))
    await userEvent.click(toggle('Microphone'))
    expect(screen.getByText(BOTH_OFF)).toBeTruthy()
    expect(start().disabled).toBe(true)
  })

  test('where no system audio can be recorded, its button is off and says why', async () => {
    await setup({ captureSources: [] })
    await openRecording()
    await waitFor(() => expect(toggle('System audio').getAttribute('aria-disabled')).toBe('true'))
    expect(toggle('System audio').getAttribute('aria-pressed')).toBe('false')
    await userEvent.hover(toggle('System audio'))
    expect((await screen.findByRole('tooltip')).textContent).toBe(NO_SYSTEM_AUDIO)
  })
})

describe('recording', () => {
  test('records with the title, model and language of the dialog; only the sources and devices are saved', async () => {
    const client = await setup({}, { settings: { transcribeModel: 'small', transcribeModelHistory: ['small'], transcribeLang: 'de' } })
    await openRecording()
    await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Small'))
    await userEvent.click(field('Model'))
    await userEvent.click(option(/Whisper Large v3/))
    await userEvent.click(field('Language'))
    await userEvent.click(option(/English/))
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Standup')
    await userEvent.click(toggle('Microphone'))
    await waitFor(() => expect(start().disabled).toBe(false))
    await userEvent.click(start())
    await waitFor(() => expect(recordDialog()).toBeNull())
    await waitFor(() => expect(recordingControl.phase).toBe('live'))
    expect((await client.getQueue()).recording).toBe(true)
    expect(await window.electronAPI!.readSettings()).toMatchObject({
      recordingAudioSource: 'system', recordingSystemDevice: '@DEFAULT_MONITOR@', transcribeModel: 'small', transcribeLang: 'de',
    })
    act(() => recordingControl.stop())
    await waitFor(async () => expect((await client.getQueue()).jobs.map(job => [job.title, job.whisper_model, job.language])).toEqual([['Standup', 'large-v3', 'en']]))
  })

  test('while a recording runs it says so and only offers Import files', async () => {
    await setup()
    act(() => recordingControl.start({ mic: false, micDeviceId: null, system: true, systemSourceId: '@DEFAULT_MONITOR@', title: 'Live', model: null, language: null }))
    await waitFor(() => expect(recordingControl.phase).toBe('live'))
    const dialog = await openRecording()
    expect(within(dialog).getByText('A recording is already in progress.')).toBeTruthy()
    expect(start().disabled).toBe(true)
    expect(toggle('Microphone').getAttribute('aria-disabled')).toBe('true')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import files' }))
    expect(await screen.findByRole('dialog', { name: 'Import files' })).toBeTruthy()
  })
})

describe('model and language', () => {
  test('models not downloaded are in the list but off', async () => {
    await setup()
    await openRecording()
    await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Large v3'))
    await userEvent.click(field('Model'))
    expect(option(/Whisper Tiny/).getAttribute('aria-disabled')).toBe('true')
    expect(option(/Whisper Tiny/).textContent).toContain('Not installed')
    expect(option(/Whisper Small/).getAttribute('aria-disabled')).toBeNull()
  })

  test('without a model it says which, with a way to Settings, and Start is off', async () => {
    await setup({ noModels: true })
    await openRecording()
    const notice = await screen.findByRole('status')
    expect(notice.textContent).toContain('No transcription model installed')
    expect(start().disabled).toBe(true)
    await userEvent.click(within(notice).getByRole('button', { name: 'Download in Settings' }))
    expect(within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('tab', { name: 'Models', selected: true })).toBeTruthy()
  })

  test('for an alignment model, Download in Settings opens its section', async () => {
    await setup({}, { settings: { transcribeLang: 'ru' } })
    await openRecording()
    await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Download in Settings' }))
    expect(within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('tab', { name: 'Languages', selected: true })).toBeTruthy()
  })

  test('the next opening starts from the defaults again', async () => {
    await setup({}, { settings: { transcribeModel: 'small', transcribeLang: 'auto' } })
    await openRecording()
    await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Small'))
    await userEvent.click(field('Model'))
    await userEvent.click(option(/Whisper Large v3/))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(recordDialog()).toBeNull())
    await openRecording()
    await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Small'))
  })
})
