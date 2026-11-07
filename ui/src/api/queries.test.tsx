import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiProvider, useApi } from './ApiProvider'
import { ApiError, type ApiClient } from './client'
import { SPEAKER_IDS, WEEKLY_SYNC_ID } from './fixtures/data'
import { EVENT_SCRIPTS } from './fixtures/event-scripts'
import { createFixtureClient, type FixtureClient, type FixtureOptions } from './fixtures/fixture-client'
import {
  AddToQueueError, useAddToQueue, useAssignSpeaker, useBackendConnected, useDeleteTranscript, useModels, useQueue, useQueueEventsSync, useSpeakerCandidates, useSpeakers, useTranscript, useTranscripts,
  useUndoSpeakerAssignment, useUpdateSegmentText, useUpdateTranscriptTitle, useWaveform,
} from './queries'
import { effectiveSpeaker, type QueueUpdate } from './types'
import { createMockElectronAPI } from '../platform/electron-api-mock'

const wrapperFor = (client: ApiClient) => ({ children }: { children: ReactNode }) => (
  <ApiProvider client={client}>{children}</ApiProvider>
)

function renderWith<T>(hook: () => T, options?: FixtureOptions) {
  const client = createFixtureClient(options)
  return { client, ...renderHook(hook, { wrapper: wrapperFor(client) }) }
}

describe('reading', () => {
  test('loads the rows', async () => {
    const { result } = renderWith(useTranscripts)
    expect(result.current.isPending).toBe(true)
    await waitFor(() => expect(result.current.data).toHaveLength(16))
  })

  test('stays pending while the backend does not answer', async () => {
    const { result } = renderWith(useTranscripts, { scenario: 'loading' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(result.current.isPending).toBe(true)
  })

  test('an empty list is data, not an error', async () => {
    const { result } = renderWith(useTranscripts, { scenario: 'empty' })
    await waitFor(() => expect(result.current.data).toEqual([]))
  })

  test('an error reaches the screen at once, without retries', async () => {
    const listTranscripts = vi.fn(() => Promise.reject(new ApiError(500, 'Server error 500')))
    const client = createFixtureClient({ overrides: { listTranscripts } })
    const { result } = renderHook(useTranscripts, { wrapper: wrapperFor(client) })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ status: 500 })
    expect(listTranscripts).toHaveBeenCalledTimes(1)
  })

  test('useApi needs a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(useApi)).toThrow(/ApiProvider/)
    vi.restoreAllMocks()
  })
})

describe('changing', () => {
  test('a new title updates the transcript and the list', async () => {
    const { result } = renderWith(() => ({
      list: useTranscripts(),
      transcript: useTranscript(WEEKLY_SYNC_ID),
      rename: useUpdateTranscriptTitle(),
    }))
    await waitFor(() => expect(result.current.transcript.data).toBeDefined())
    await act(() => result.current.rename.mutateAsync({ transcriptId: WEEKLY_SYNC_ID, title: 'Renamed' }))
    await waitFor(() => expect(result.current.transcript.data?.title).toBe('Renamed'))
    await waitFor(() => expect(result.current.list.data?.find(t => t.id === WEEKLY_SYNC_ID)?.title).toBe('Renamed'))
  })

  test('assigning updates the segments and the candidates', async () => {
    const { unknown1, mark } = SPEAKER_IDS
    const { result } = renderWith(() => ({
      transcript: useTranscript(WEEKLY_SYNC_ID),
      candidates: useSpeakerCandidates(WEEKLY_SYNC_ID),
      speakers: useSpeakers(),
      assign: useAssignSpeaker(),
    }))
    await waitFor(() => expect(result.current.candidates.data).toHaveProperty(unknown1))
    await act(() => result.current.assign.mutateAsync({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [16], target: { id: mark } }))
    await waitFor(() => expect(result.current.candidates.data).not.toHaveProperty(unknown1))
    const segment = result.current.transcript.data?.segments.find(s => s.start === 16)
    expect(segment && effectiveSpeaker(segment)).toBe(mark)
  })

  test('a failed change reaches the caller and changes nothing', async () => {
    const { result } = renderWith(() => ({
      transcript: useTranscript(WEEKLY_SYNC_ID),
      edit: useUpdateSegmentText(),
    }), { overrides: { updateSegmentText: () => Promise.reject(new ApiError(409, 'Busy')) } })
    await waitFor(() => expect(result.current.transcript.data).toBeDefined())
    const text = result.current.transcript.data?.segments[0].text
    await act(async () => {
      await expect(result.current.edit.mutateAsync({ transcriptId: WEEKLY_SYNC_ID, segmentStart: 0, text: 'x' }))
        .rejects.toMatchObject({ status: 409 })
    })
    expect(result.current.transcript.data?.segments[0].text).toBe(text)
  })
})

describe('queue events', () => {
  const setup = () => renderWith(() => {
    useQueueEventsSync()
    return { queue: useQueue(), list: useTranscripts() }
  })

  test('snapshots land in the cache', async () => {
    const { client, result } = setup()
    await waitFor(() => expect(result.current.queue.data?.jobs).toEqual([]))
    act(() => { client.playEvents(EVENT_SCRIPTS.transcribing) })
    await waitFor(() => expect(result.current.queue.data?.jobs).toHaveLength(1))
  })

  test('job_done brings the new recording into the list', async () => {
    const client: FixtureClient = createFixtureClient()
    const { result } = renderHook(() => {
      useQueueEventsSync()
      return useTranscripts()
    }, { wrapper: wrapperFor(client) })
    await waitFor(() => expect(result.current.data).toHaveLength(16))
    act(() => { client.playEvents({ ...EVENT_SCRIPTS.transcribing, steps: EVENT_SCRIPTS.transcribing.steps.map(s => ({ ...s, afterMs: 0 })) }) })
    await waitFor(() => expect(result.current.data).toHaveLength(17))
    expect(result.current.data?.[0].title).toBe('Planning call')
  })

  test('onEvent gets the events, and unmounting ends them', async () => {
    const client = createFixtureClient()
    const events: QueueUpdate[] = []
    const { unmount } = renderHook(() => useQueueEventsSync(e => events.push(e)), { wrapper: wrapperFor(client) })
    await waitFor(() => expect(events).toHaveLength(1))
    unmount()
    client.playEvents({ steps: [{ afterMs: 0, event: EVENT_SCRIPTS.failed.steps[0].event }] })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(events).toHaveLength(1)
  })
})

describe('assigning a turn', () => {
  test('a new speaker for a turn of several segments is one speaker, and the answer names it', async () => {
    const { client, result } = renderWith(useAssignSpeaker)
    const before = (await client.listSpeakers()).length
    const { speakerId } = await act(() => result.current.mutateAsync({
      transcriptId: WEEKLY_SYNC_ID, segmentStarts: [5, 8], target: { name: 'Olivia Brown', colorIndex: 2 },
    }))
    const speakers = await client.listSpeakers()
    expect(speakers).toHaveLength(before + 1)
    const created = speakers.find(s => s.name === 'Olivia Brown')!
    expect(created.id).toBe(speakerId)
    expect(created.color_index).toBe(2)
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    expect(segments.filter(s => effectiveSpeaker(s) === created.id).map(s => s.start)).toEqual([5, 8])
  })

  test('is one request whatever the length of the turn', async () => {
    const client = createFixtureClient()
    const assign = vi.spyOn(client, 'assignSpeaker')
    const listSpeakers = vi.spyOn(client, 'listSpeakers')
    const { result } = renderHook(useAssignSpeaker, { wrapper: wrapperFor(client) })
    await act(() => result.current.mutateAsync({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [5, 8], target: { id: SPEAKER_IDS.anna } }))
    expect(assign).toHaveBeenCalledOnce()
    expect(listSpeakers.mock.calls.length).toBe(0)
  })
})

describe('undoing an assignment', () => {
  test('refreshes what the assignment changed', async () => {
    const { client, result } = renderWith(() => ({ undo: useUndoSpeakerAssignment(), candidates: useSpeakerCandidates(WEEKLY_SYNC_ID) }))
    const { unknown1, mark } = SPEAKER_IDS
    await waitFor(() => expect(result.current.candidates.data?.[unknown1]).toBeTruthy())
    await client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [16], target: { id: mark } })
    await act(() => result.current.undo.mutateAsync({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [16], speakerId: unknown1 }))
    await waitFor(() => expect(result.current.candidates.data?.[unknown1]).toBeTruthy())
  })
})

describe('deleting a recording', () => {
  const setup = (overrides: Partial<ApiClient> = {}) => {
    const client = createFixtureClient({ overrides })
    const getTranscript = vi.spyOn(client, 'getTranscript')
    const view = renderHook(() => ({
      list: useTranscripts(),
      open: useTranscript(WEEKLY_SYNC_ID),
      remove: useDeleteTranscript(),
    }), { wrapper: wrapperFor(client) })
    return { ...view, getTranscript }
  }
  const has = (rows: { id: number }[] | undefined) => rows?.some(row => row.id === WEEKLY_SYNC_ID)

  test('leaves the list at once and its details are not asked for again', async () => {
    const { result, getTranscript } = setup()
    await waitFor(() => expect(has(result.current.list.data)).toBe(true))
    await waitFor(() => expect(result.current.open.data).toBeTruthy())
    getTranscript.mockClear()
    await act(() => result.current.remove.mutateAsync(WEEKLY_SYNC_ID))
    await waitFor(() => expect(has(result.current.list.data)).toBe(false))
    await waitFor(() => expect(result.current.list.isFetching).toBe(false))
    expect(getTranscript).not.toHaveBeenCalled()
  })

  test('a recording already gone counts as deleted', async () => {
    const { result } = setup({ deleteTranscript: () => Promise.reject(new ApiError(404, 'Transcript not found')) })
    await waitFor(() => expect(has(result.current.list.data)).toBe(true))
    await expect(act(() => result.current.remove.mutateAsync(WEEKLY_SYNC_ID))).resolves.toBeUndefined()
  })

  test('another failure reaches the caller and the list stays', async () => {
    const { result } = setup({ deleteTranscript: () => Promise.reject(new ApiError(500, 'Server error 500')) })
    await waitFor(() => expect(has(result.current.list.data)).toBe(true))
    await act(async () => { await expect(result.current.remove.mutateAsync(WEEKLY_SYNC_ID)).rejects.toThrow('Server error 500') })
    expect(has(result.current.list.data)).toBe(true)
  })
})

describe('the connection to the backend', () => {
  const setup = () => {
    const client = createFixtureClient()
    const view = renderHook(() => {
      useQueueEventsSync()
      return { connected: useBackendConnected(), list: useTranscripts() }
    }, { wrapper: wrapperFor(client) })
    return { client, ...view }
  }

  test('counts as there until it is lost, and is there again after', async () => {
    const { client, result } = setup()
    expect(result.current.connected).toBe(true)
    act(() => client.setConnected(false))
    await waitFor(() => expect(result.current.connected).toBe(false))
    act(() => client.setConnected(true))
    await waitFor(() => expect(result.current.connected).toBe(true))
  })

  test('being back refreshes what was missed', async () => {
    const { client, result } = setup()
    await waitFor(() => expect(result.current.list.data).toHaveLength(16))
    const list = vi.spyOn(client, 'listTranscripts')
    act(() => client.setConnected(false))
    expect(list).not.toHaveBeenCalled()
    act(() => client.setConnected(true))
    await waitFor(() => expect(list).toHaveBeenCalled())
  })

  test('being back clears an error of a first load', async () => {
    const client = createFixtureClient()
    const list = vi.spyOn(client, 'listTranscripts').mockRejectedValueOnce(new ApiError(0, 'Failed to fetch'))
    const { result } = renderHook(() => {
      useQueueEventsSync()
      return useTranscripts()
    }, { wrapper: wrapperFor(client) })
    await waitFor(() => expect(result.current.isError).toBe(true))
    act(() => client.setConnected(false))
    act(() => client.setConnected(true))
    await waitFor(() => expect(result.current.data).toHaveLength(16))
    expect(list).toHaveBeenCalledTimes(2)
  })
})

describe('waveform', () => {
  test('loads the levels of a stretch', async () => {
    const { result } = renderWith(() => useWaveform(WEEKLY_SYNC_ID, { bars: 4, start: 0, end: 20 }))
    await waitFor(() => expect(result.current.data).toHaveLength(4))
  })

  test('asks for nothing with no recording or no length yet', () => {
    const getWaveform = vi.fn()
    const options = { overrides: { getWaveform } }
    renderWith(() => useWaveform(null, { bars: 4, start: 0, end: 20 }), options)
    renderWith(() => useWaveform(WEEKLY_SYNC_ID, { bars: 4, start: 0, end: 0 }), options)
    expect(getWaveform).not.toHaveBeenCalled()
  })
})

describe('models', () => {
  test('reads the catalog with what is downloaded, and again when a screen mounts', async () => {
    const client = createFixtureClient({ installedModels: ['tiny', 'diarize'] })
    const list = vi.spyOn(client, 'listModels')
    const wrapper = wrapperFor(client)
    const first = renderHook(useModels, { wrapper })
    await waitFor(() => expect(first.result.current.data?.filter(m => m.installed).map(m => m.id)).toEqual(['tiny', 'diarize']))
    renderHook(useModels, { wrapper })
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })
})

describe('adding files to the queue', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('one job per file, in the order given, with the defaults of the settings', async () => {
    const bridge = createMockElectronAPI()
    await bridge.writeSettings({ ...await bridge.readSettings(), transcribeModel: 'small', transcribeLang: 'de' })
    vi.stubGlobal('electronAPI', bridge)
    const { client, result } = renderWith(useAddToQueue)
    const add = vi.spyOn(client, 'addQueueJob')
    await act(() => result.current.mutateAsync(['/in/b.mp3', '/in/a.wav']))
    expect(add.mock.calls.map(([job]) => job)).toEqual([
      { audioPath: '/in/b.mp3', whisperModel: 'small', language: 'de' },
      { audioPath: '/in/a.wav', whisperModel: 'small', language: 'de' },
    ])
    expect((await client.getQueue()).jobs.map(job => job.audio_path)).toEqual(['/in/b.mp3', '/in/a.wav'])
  })

  test('with no model saved and auto language the backend decides both', async () => {
    const { client, result } = renderWith(useAddToQueue)
    const add = vi.spyOn(client, 'addQueueJob')
    await act(() => result.current.mutateAsync(['/in/a.mp3']))
    expect(add).toHaveBeenCalledWith({ audioPath: '/in/a.mp3', whisperModel: null, language: null })
  })

  test('stops at the first refusal and says how many went in', async () => {
    const client = createFixtureClient()
    let calls = 0
    const add = client.addQueueJob
    client.addQueueJob = job => (++calls === 2 ? Promise.reject(new ApiError(400, 'audio_path not readable: /in/b.mp3')) : add(job))
    const { result } = renderHook(useAddToQueue, { wrapper: wrapperFor(client) })
    const failure = await act(() => result.current.mutateAsync(['/in/a.mp3', '/in/b.mp3', '/in/c.mp3']).catch(error => error))
    expect(failure).toBeInstanceOf(AddToQueueError)
    expect(failure).toMatchObject({ added: 1, message: 'audio_path not readable: /in/b.mp3', error: { status: 400 } })
    expect(calls).toBe(2)
  })
})
