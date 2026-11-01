import { describe, expect, test, vi } from 'vitest'
import { createBackendClient } from './backend-client'
import { ApiError } from './client'

type Sent = { url: string; method: string; body: unknown }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// A client over a stub fetch; `sent` collects what it asked for.
function setup(respond: () => Response = () => new Response(null, { status: 204 })) {
  const sent: Sent[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const request = input as Request
    const text = await request.text()
    sent.push({ url: request.url, method: request.method, body: text ? JSON.parse(text) : undefined })
    return respond()
  })
  return { client: createBackendClient({ fetch: fetch as typeof globalThis.fetch }), sent }
}

describe('assignSpeaker', () => {
  test('one segment: PATCH the segment speaker', async () => {
    const { client, sent } = setup()
    await client.assignSpeaker({ transcriptId: 7, segmentStart: 1.5, target: { id: 'b' } })
    expect(sent).toEqual([{
      url: 'http://localhost:8000/transcripts/7/segments/1.5/speaker',
      method: 'PATCH',
      body: { speaker_id: 'b' },
    }])
  })

  test('one segment at the very start, for a new speaker with a colour', async () => {
    const { client, sent } = setup()
    await client.assignSpeaker({ transcriptId: 7, segmentStart: 0, target: { name: 'Dana', colorIndex: 3 } })
    expect(sent[0].url).toBe('http://localhost:8000/transcripts/7/segments/0/speaker')
    expect(sent[0].body).toEqual({ speaker_name: 'Dana', color_index: 3 })
  })

  test('no segment: POST reassign of every segment of the speaker', async () => {
    const { client, sent } = setup()
    await client.assignSpeaker({ transcriptId: 7, fromSpeakerId: 'x', target: { id: 'b' } })
    expect(sent).toEqual([{
      url: 'http://localhost:8000/transcripts/7/reassign',
      method: 'POST',
      body: { from_speaker_id: 'x', to_speaker_id: 'b' },
    }])
  })

  test('a new speaker keeps colour 0, and has no colour when none was chosen', async () => {
    const { client, sent } = setup()
    await client.assignSpeaker({ transcriptId: 7, fromSpeakerId: 'x', target: { name: 'Dana', colorIndex: 0 } })
    await client.assignSpeaker({ transcriptId: 7, fromSpeakerId: 'x', target: { name: 'Dana' } })
    expect(sent[0].body).toEqual({ from_speaker_id: 'x', to_speaker_name: 'Dana', color_index: 0 })
    expect(sent[1].body).toEqual({ from_speaker_id: 'x', to_speaker_name: 'Dana' })
  })
})

describe('requests', () => {
  test('a new title: PATCH the transcript', async () => {
    const { client, sent } = setup()
    await client.updateTranscriptTitle(7, 'Weekly sync')
    expect(sent).toEqual([{ url: 'http://localhost:8000/transcripts/7', method: 'PATCH', body: { title: 'Weekly sync' } }])
  })

  test('segment text and removal', async () => {
    const { client, sent } = setup()
    await client.updateSegmentText(7, 2.5, 'Hello')
    await client.deleteSegment(7, 2.5)
    expect(sent[0]).toEqual({ url: 'http://localhost:8000/transcripts/7/segments/2.5/text', method: 'PATCH', body: { text: 'Hello' } })
    expect(sent[1]).toMatchObject({ url: 'http://localhost:8000/transcripts/7/segments/2.5', method: 'DELETE' })
  })

  test('a voice sample, with and without a transcript', async () => {
    const { client, sent } = setup(() => json({ transcript_id: 7, audio_path: 'a.wav', start: 0, end: 1, text: 'x' }))
    await client.getSpeakerSample('s')
    await client.getSpeakerSample('s', 7)
    expect(sent.map(s => s.url)).toEqual([
      'http://localhost:8000/speakers/s/sample',
      'http://localhost:8000/speakers/s/sample?transcript_id=7',
    ])
  })

  test('returns the body', async () => {
    const rows = [{ id: 1, title: 'a' }]
    const { client } = setup(() => json(rows))
    await expect(client.listTranscripts()).resolves.toEqual(rows)
  })
})

describe('getSpeakerCandidates', () => {
  test('the one suggestion of each speaker becomes a list', async () => {
    const candidate = { speaker_id: 'm', name: 'Mark', score: 0.82 }
    const { client } = setup(() => json({ u1: candidate }))
    await expect(client.getSpeakerCandidates(7)).resolves.toEqual({ u1: [candidate] })
  })

  test('no suggestions', async () => {
    const { client } = setup(() => json({}))
    await expect(client.getSpeakerCandidates(7)).resolves.toEqual({})
  })
})

describe('errors', () => {
  const failure = async (promise: Promise<unknown>) => promise.then(() => { throw new Error('did not fail') }, e => e as ApiError)

  test('carries the detail and the status', async () => {
    const { client } = setup(() => json({ detail: 'Transcript not found' }, 404))
    const error = await failure(client.getTranscript(7))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, message: 'Transcript not found' })
  })

  test('takes the first message of a rejected request', async () => {
    const { client } = setup(() => json({ detail: [{ loc: ['body', 'title'], msg: 'Too short', type: 'x' }] }, 422))
    expect(await failure(client.updateTranscriptTitle(7, ''))).toMatchObject({ status: 422, message: 'Too short' })
  })

  test('falls back to the status', async () => {
    const { client } = setup(() => new Response('oops', { status: 500 }))
    expect(await failure(client.listSpeakers())).toMatchObject({ status: 500, message: 'Server error 500' })
  })

  test('a backend that does not answer', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const client = createBackendClient({ fetch: fetch as typeof globalThis.fetch })
    expect(await failure(client.listTranscripts())).toMatchObject({ status: 0, message: 'Failed to fetch' })
  })
})
