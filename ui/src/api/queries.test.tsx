import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { ApiProvider, useApi } from './ApiProvider'
import { ApiError, type ApiClient } from './client'
import { SPEAKER_IDS, WEEKLY_SYNC_ID } from './fixtures/data'
import { EVENT_SCRIPTS } from './fixtures/event-scripts'
import { createFixtureClient, type FixtureClient, type FixtureOptions } from './fixtures/fixture-client'
import {
  useAssignSpeaker, useAssignTurnSpeaker, useQueue, useQueueEventsSync, useSpeakerCandidates, useSpeakers, useTranscript, useTranscripts,
  useUndoSpeakerAssignment, useUpdateSegmentText, useUpdateTranscriptTitle,
} from './queries'
import { effectiveSpeaker, type QueueUpdate } from './types'

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
    await act(() => result.current.assign.mutateAsync({ transcriptId: WEEKLY_SYNC_ID, fromSpeakerId: unknown1, target: { id: mark } }))
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
  test('a new speaker for a turn of several segments is one speaker', async () => {
    const { client, result } = renderWith(useAssignTurnSpeaker)
    const before = (await client.listSpeakers()).length
    await act(() => result.current.mutateAsync({
      transcriptId: WEEKLY_SYNC_ID, segmentStarts: [5, 8], target: { name: 'Olivia Brown', colorIndex: 2 },
    }))
    const speakers = await client.listSpeakers()
    expect(speakers).toHaveLength(before + 1)
    const created = speakers.find(s => s.name === 'Olivia Brown')!
    expect(created.color_index).toBe(2)
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    expect(segments.filter(s => effectiveSpeaker(s) === created.id).map(s => s.start)).toEqual([5, 8])
  })

  test('an existing speaker asks for no list of speakers', async () => {
    const client = createFixtureClient()
    const listSpeakers = vi.spyOn(client, 'listSpeakers')
    const { result } = renderHook(useAssignTurnSpeaker, { wrapper: wrapperFor(client) })
    await act(() => result.current.mutateAsync({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [5, 8], target: { id: SPEAKER_IDS.anna } }))
    expect(listSpeakers.mock.calls.length).toBe(0)
  })
})

describe('undoing an assignment', () => {
  test('refreshes what the assignment changed', async () => {
    const { client, result } = renderWith(() => ({ undo: useUndoSpeakerAssignment(), candidates: useSpeakerCandidates(WEEKLY_SYNC_ID) }))
    const { unknown1, mark } = SPEAKER_IDS
    await waitFor(() => expect(result.current.candidates.data?.[unknown1]).toBeTruthy())
    await client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, fromSpeakerId: unknown1, target: { id: mark } })
    await act(() => result.current.undo.mutateAsync({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [16], speakerId: unknown1 }))
    await waitFor(() => expect(result.current.candidates.data?.[unknown1]).toBeTruthy())
  })
})
