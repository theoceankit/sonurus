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
import { RecordingProvider, useRecording } from '../../recording/RecordingProvider'
import type { SessionDeps } from '../../recording/session'
import type { ApiClient } from '../../api/client'
import { BOTH_OFF, NO_SYSTEM_AUDIO } from '../../recording/sources'
import { SettingsProvider } from '../Settings/SettingsProvider'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

function setup(options: FixtureOptions = {}, chosen: string[] = []) {
  const client = createFixtureClient(options)
  vi.stubGlobal('electronAPI', createMockElectronAPI({ openFiles: async () => chosen }))
  render(<ApiProvider client={client}><OverlayProvider><SettingsProvider><EditorScreen /></SettingsProvider></OverlayProvider></ApiProvider>)
  return client
}

// jsdom has no DragEvent or DataTransfer.
function drag(type: string, { files = ['a.mp3'], types = ['Files'] } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { types, files: files.map(name => new File([], name)), dropEffect: 'none' } })
  act(() => { document.body.dispatchEvent(event) })
  return event
}

const dialog = () => screen.queryByRole('dialog', { name: 'New recording' })
const listed = () => within(screen.getByRole('list', { name: 'Files to import' })).getAllByRole('listitem').map(item => item.textContent!.trim())
const openByButton = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'New recording' }))
  return screen.findByRole('dialog', { name: 'New recording' })
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
    await screen.findByRole('button', { name: 'New recording' })
    drag('dragenter')
    expect(await screen.findByRole('dialog', { name: 'New recording' })).toBeTruthy()
    // Over the window but not over the zone: the zone stays as it is.
    expect(screen.getByText('Drop audio or video files here')).toBeTruthy()
    drag('dragleave')
    await waitFor(() => expect(dialog()).toBeNull())
  })

  test('a drag of text opens nothing', async () => {
    setup()
    await screen.findByRole('button', { name: 'New recording' })
    drag('dragenter', { types: ['text/plain'] })
    expect(dialog()).toBeNull()
  })

  test('opens again on the next drag after a drop', async () => {
    setup()
    await screen.findByRole('button', { name: 'New recording' })
    drag('dragenter')
    drag('drop')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(dialog()).toBeNull())
    drag('dragenter')
    expect(await screen.findByRole('dialog', { name: 'New recording' })).toBeTruthy()
  })
})

describe('the files', () => {
  test('a drop anywhere lists the audio, names the rest in a toast, and the dialog stays', async () => {
    setup()
    await screen.findByRole('button', { name: 'New recording' })
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
    await screen.findByRole('button', { name: 'New recording' })
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

  test('a model refused by the backend shows in the dialog, with a way to Settings', async () => {
    // The catalog said it was there; it went before the job did.
    setup({ overrides: { addQueueJob: () => Promise.reject(new ApiError(400, NO_MODELS)) } }, ['/in/a.mp3'])
    await openByButton()
    await userEvent.click(screen.getByRole('button', { name: 'Choose files' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(NO_MODELS)
    expect(dialog()).toBeTruthy()
    expect(listed()).toEqual(['a.mp3'])
    await userEvent.click(within(alert).getByRole('button', { name: 'Open Settings' }))
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy()
    await waitFor(() => expect(dialog()).toBeNull())
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
  setup({ overrides: { addQueueJob: () => Promise.reject(new ApiError(400, NO_MODELS)) } }, ['/in/a.mp3'])
  await openByButton()
  await userEvent.click(screen.getByRole('button', { name: 'Choose files' }))
  await userEvent.click(screen.getByRole('button', { name: 'Import' }))
  expect((await screen.findByRole('alert')).querySelector('svg:not(button svg)')).toBeNull()
})

describe('title, model and language', () => {
  const choose = async () => userEvent.click(screen.getByRole('button', { name: 'Choose files' }))
  const importButton = () => screen.getByRole('button', { name: 'Import' })
  const field = (name: string) => screen.getByRole('button', { name })
  const option = (name: RegExp) => screen.getByRole('menuitemradio', { name })
  const jobs = async (client: ReturnType<typeof setup>) => (await client.getQueue()).jobs.map(job => ({
    title: job.title, model: job.whisper_model, language: job.language,
  }))
  const saved = async (settings: object) => {
    const bridge = createMockElectronAPI({ openFiles: async () => [] })
    await bridge.writeSettings({ ...await bridge.readSettings(), ...settings })
    return bridge
  }
  function setupWith(options: FixtureOptions, chosen: string[], settings: object = {}) {
    const client = createFixtureClient(options)
    return saved(settings).then(bridge => {
      vi.stubGlobal('electronAPI', { ...bridge, openFiles: async () => chosen })
      render(<ApiProvider client={client}><OverlayProvider><SettingsProvider><EditorScreen /></SettingsProvider></OverlayProvider></ApiProvider>)
      return client
    })
  }

  test('one file keeps a typed title, trimmed', async () => {
    const client = await setupWith({}, ['/in/a.mp3'])
    await openByButton()
    await choose()
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), '  Weekly sync ')
    await userEvent.click(importButton())
    await waitFor(async () => expect((await jobs(client))[0]?.title).toBe('Weekly sync'))
  })

  test('the title field shows the date as a hint, and untouched the file is named after itself', async () => {
    const client = await setupWith({}, ['/in/Team call.m4a'])
    await openByButton()
    const title = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement
    expect(title.value).toBe('')
    expect(title.placeholder).toBe('5 Oct 12:00 Meeting')
    await choose()
    await userEvent.click(importButton())
    await waitFor(async () => expect((await jobs(client))[0]?.title).toBe('Team call'))
  })

  test('several files are each named after their file, and the title field is off', async () => {
    const client = await setupWith({}, ['/in/b.mp3', '/in/a.wav'])
    await openByButton()
    await choose()
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveProperty('disabled', true)
    await userEvent.click(importButton())
    await waitFor(async () => expect((await jobs(client)).map(job => job.title)).toEqual(['b', 'a']))
  })

  test('model and language start from the defaults; a choice here is for this import and is not saved', async () => {
    const client = await setupWith({}, ['/in/a.mp3'], { transcribeModel: 'small', transcribeModelHistory: ['small'], transcribeLang: 'de' })
    await openByButton()
    await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Small'))
    expect(field('Language').textContent?.trim()).toBe('Deutsch')
    await userEvent.click(field('Model'))
    await userEvent.click(option(/Whisper Large v3/))
    await userEvent.click(field('Language'))
    await userEvent.click(option(/English/))
    await choose()
    await userEvent.click(importButton())
    await waitFor(async () => expect(await jobs(client)).toEqual([{ title: 'a', model: 'large-v3', language: 'en' }]))
    expect(await window.electronAPI!.readSettings()).toMatchObject({ transcribeModel: 'small', transcribeLang: 'de' })
  })

  test('the next opening starts from the defaults again', async () => {
    await setupWith({}, [], { transcribeModel: 'small', transcribeLang: 'auto' })
    await openByButton()
    await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Small'))
    await userEvent.click(field('Model'))
    await userEvent.click(option(/Whisper Large v3/))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(dialog()).toBeNull())
    await openByButton()
    await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Small'))
  })

  test('models not downloaded are in the list but off', async () => {
    await setupWith({}, [])
    await openByButton()
    await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Large v3'))
    await userEvent.click(field('Model'))
    expect(option(/Whisper Tiny/).getAttribute('aria-disabled')).toBe('true')
    expect(option(/Whisper Tiny/).textContent).toContain('Not installed')
    expect(option(/Whisper Small/).getAttribute('aria-disabled')).toBeNull()
  })

  test('a saved default that is not downloaded is not used', async () => {
    const client = await setupWith({ installedModels: ['small', 'diarize'] }, ['/in/a.mp3'], { transcribeModel: 'large-v3' })
    await openByButton()
    await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Small'))
    await choose()
    await userEvent.click(importButton())
    await waitFor(async () => expect((await jobs(client))[0]?.model).toBe('small'))
  })

  test('until the models are known, it opens and waits with Import off', async () => {
    await setupWith({ overrides: { listModels: () => new Promise(() => {}) } }, ['/in/a.mp3'])
    await openByButton()
    expect(field('Model').textContent?.trim()).toBe('Checking models…')
    await choose()
    expect(importButton()).toHaveProperty('disabled', true)
  })

  test.each([
    [{ noModels: true }, 'auto', 'No transcription model installed'],
    [{ installedModels: ['small'] }, 'auto', 'Diarization model not installed'],
    [{}, 'ru', 'Alignment model for Русский is not installed'],
  ])('without a model a job needs it says which, with a way to Settings, and Import is off (%o, %s)', async (options, language, message) => {
    const client = await setupWith(options, ['/in/a.mp3'], { transcribeLang: language })
    await openByButton()
    const notice = await screen.findByRole('status')
    expect(notice.textContent).toContain(message)
    await choose()
    expect(listed()).toEqual(['a.mp3'])
    expect(importButton()).toHaveProperty('disabled', true)
    expect((await client.getQueue()).jobs).toEqual([])
    expect(within(notice).getByRole('button', { name: 'Download in Settings' })).toBeTruthy()
  })

  test('for an alignment model, Download in Settings opens its section', async () => {
    await setupWith({}, [], { transcribeLang: 'ru' })
    await openByButton()
    await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Download in Settings' }))
    expect(within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('tab', { name: 'Languages', selected: true })).toBeTruthy()
  })

  test('Download in Settings closes the dialog for Settings', async () => {
    await setupWith({ noModels: true }, [])
    await openByButton()
    await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Download in Settings' }))
    expect(within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('tab', { name: 'Models', selected: true })).toBeTruthy()
    await waitFor(() => expect(dialog()).toBeNull())
  })

  test('a language whose alignment model is not downloaded is off; picking Detect lets the import go', async () => {
    const client = await setupWith({}, ['/in/a.mp3'], { transcribeLang: 'ru' })
    await openByButton()
    await screen.findByRole('status')
    await userEvent.click(field('Language'))
    expect(option(/Русский/).getAttribute('aria-disabled')).toBe('true')
    expect(option(/English/).getAttribute('aria-disabled')).toBeNull()
    await userEvent.click(option(/Detect automatically/))
    expect(screen.queryByRole('status')).toBeNull()
    await choose()
    await userEvent.click(importButton())
    await waitFor(async () => expect((await jobs(client))[0]?.language).toBeNull())
  })

  test('Diarize speakers is there, off and marked as not there yet', async () => {
    await setupWith({}, [])
    await openByButton()
    const diarize = screen.getByRole('button', { name: 'Diarize speakers' })
    expect(diarize.getAttribute('data-not-implemented')).toBe('new-transcription.diarize')
    expect(diarize.getAttribute('aria-pressed')).toBeNull()
  })
})

describe('recording', () => {
  // The window's audio in jsdom: system audio only, the backend's fixture captures it.
  const noMicrophone = (api: ApiClient): SessionDeps => ({
    api,
    platform: async () => 'linux',
    getUserMedia: () => Promise.reject(new Error('no microphone here')),
    connect: () => { throw new Error('no audio here') },
    createRecorder: () => { throw new Error('no audio here') },
  })
  let control: ReturnType<typeof useRecording>
  const Probe = () => { control = useRecording(); return null }

  async function setupRecording(options: FixtureOptions = {}, settings: object = {}) {
    const client = createFixtureClient(options)
    const bridge = createMockElectronAPI()
    await bridge.writeSettings({ ...await bridge.readSettings(), ...settings })
    vi.stubGlobal('electronAPI', bridge)
    render(
      <ApiProvider client={client}><OverlayProvider><RecordingProvider deps={noMicrophone}><SettingsProvider>
        <EditorScreen /><Probe />
      </SettingsProvider></RecordingProvider></OverlayProvider></ApiProvider>,
    )
    return client
  }
  const toggle = (name: string) => screen.getByRole('button', { name })
  const start = () => screen.getByRole('button', { name: 'Start recording' }) as HTMLButtonElement
  const field = (name: string) => screen.getByRole('button', { name })
  const option = (name: RegExp) => screen.getByRole('menuitemradio', { name })

  test('New recording asks for consent; Diarize speakers is the only switch, still not there', async () => {
    await setupRecording()
    const dialog = await openByButton()
    expect(within(dialog).getByText('Make sure all participants have agreed to be recorded.')).toBeTruthy()
    expect(within(dialog).queryAllByRole('switch')).toHaveLength(0)
    expect(JSON.stringify(await window.electronAPI!.readSettings())).not.toContain('SaveAudio')
  })

  test('starts from the sources and devices saved last', async () => {
    await setupRecording({}, { recordingAudioSource: 'mic', recordingSystemDevice: 'bluez_output.58_18_62_38_72_FA.1.monitor' })
    await openByButton()
    await waitFor(() => expect(toggle('Microphone').getAttribute('aria-pressed')).toBe('true'))
    expect(toggle('System audio').getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(toggle('System audio device'))
    expect((await screen.findByRole('menuitem', { name: 'WH-1000XM5' })).querySelector('svg:last-child')).toBeTruthy()
  })

  test('records with the title, model and language of the dialog; only the sources and devices are saved', async () => {
    const client = await setupRecording({}, { transcribeModel: 'small', transcribeModelHistory: ['small'], transcribeLang: 'de' })
    await openByButton()
    await waitFor(() => expect(field('Model').textContent?.trim()).toBe('Whisper Small'))
    await userEvent.click(field('Model'))
    await userEvent.click(option(/Whisper Large v3/))
    await userEvent.click(field('Language'))
    await userEvent.click(option(/English/))
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Standup')
    await userEvent.click(toggle('Microphone'))
    await waitFor(() => expect(start().disabled).toBe(false))
    await userEvent.click(start())
    await waitFor(() => expect(dialog()).toBeNull())
    await waitFor(() => expect(control.phase).toBe('live'))
    expect((await client.getQueue()).recording).toBe(true)
    expect(await window.electronAPI!.readSettings()).toMatchObject({
      recordingAudioSource: 'system', recordingSystemDevice: '@DEFAULT_MONITOR@', transcribeModel: 'small', transcribeLang: 'de',
    })
    act(() => control.stop())
    await waitFor(async () => expect((await client.getQueue()).jobs.map(job => [job.title, job.whisper_model, job.language])).toEqual([['Standup', 'large-v3', 'en']]))
  })

  test('with both sources off, Start is off and says why', async () => {
    await setupRecording({}, { recordingAudioSource: 'mic' })
    await openByButton()
    await waitFor(() => expect(toggle('Microphone').getAttribute('aria-pressed')).toBe('true'))
    await userEvent.click(toggle('Microphone'))
    expect(screen.getByText(BOTH_OFF)).toBeTruthy()
    expect(start().disabled).toBe(true)
  })

  test('where no system audio can be recorded, its button is off and says why', async () => {
    await setupRecording({ captureSources: [] })
    await openByButton()
    await waitFor(() => expect(toggle('System audio').getAttribute('aria-disabled')).toBe('true'))
    expect(toggle('System audio').getAttribute('aria-pressed')).toBe('false')
    await userEvent.hover(toggle('System audio'))
    expect((await screen.findByRole('tooltip')).textContent).toBe(NO_SYSTEM_AUDIO)
  })

  test('while a recording runs the dialog only imports', async () => {
    const client = await setupRecording()
    act(() => control.start({ mic: false, micDeviceId: null, system: true, systemSourceId: '@DEFAULT_MONITOR@', title: 'Live', model: null, language: null }))
    await waitFor(() => expect(control.phase).toBe('live'))
    vi.stubGlobal('electronAPI', { ...window.electronAPI, openFiles: async () => ['/in/a.mp3'] })
    await openByButton()
    expect(screen.getByText('A recording is already in progress. Files can still be imported.')).toBeTruthy()
    expect(start().disabled).toBe(true)
    expect(toggle('Microphone').getAttribute('aria-disabled')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'Choose files' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(async () => expect((await client.getQueue()).jobs.map(job => job.title)).toEqual(['a']))
  })
})
