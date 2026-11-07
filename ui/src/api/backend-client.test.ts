import { describe, expect, test, vi } from 'vitest'
import { createBackendClient } from './backend-client'
import { ApiError } from './client'
import type { Transcript } from './types'

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
  test('sends the segments and an existing speaker, and answers the id', async () => {
    const { client, sent } = setup(() => json({ speaker_id: 'b' }))
    await expect(client.assignSpeaker({ transcriptId: 7, segmentStarts: [0, 1.5], target: { id: 'b' } })).resolves.toEqual({ speakerId: 'b' })
    expect(sent).toEqual([{
      url: 'http://localhost:8000/transcripts/7/speaker-assignments',
      method: 'POST',
      body: { segment_starts: [0, 1.5], speaker_id: 'b' },
    }])
  })

  test('a new speaker keeps colour 0, and has no colour when none was chosen', async () => {
    const { client, sent } = setup(() => json({ speaker_id: 'n' }))
    await expect(client.assignSpeaker({ transcriptId: 7, segmentStarts: [0], target: { name: 'Dana', colorIndex: 0 } })).resolves.toEqual({ speakerId: 'n' })
    await client.assignSpeaker({ transcriptId: 7, segmentStarts: [0], target: { name: 'Dana' } })
    expect(sent[0].body).toEqual({ segment_starts: [0], speaker_name: 'Dana', color_index: 0 })
    expect(sent[1].body).toEqual({ segment_starts: [0], speaker_name: 'Dana' })
  })
})

describe('undoSpeakerAssignment', () => {
  test('sends the segments and who had them', async () => {
    const { client, sent } = setup(() => new Response(null, { status: 204 }))
    await client.undoSpeakerAssignment({ transcriptId: 7, segmentStarts: [0, 1.5], speakerId: 'a' })
    expect(sent).toEqual([{
      url: 'http://localhost:8000/transcripts/7/speaker-assignments/undo',
      method: 'POST',
      body: { segment_starts: [0, 1.5], speaker_id: 'a' },
    }])
  })

  test('names the speaker the assignment created', async () => {
    const { client, sent } = setup(() => new Response(null, { status: 204 }))
    await client.undoSpeakerAssignment({ transcriptId: 7, segmentStarts: [0], speakerId: 'a', createdSpeakerId: 'n' })
    expect(sent[0].body).toEqual({ segment_starts: [0], speaker_id: 'a', created_speaker_id: 'n' })
  })
})

describe('requests', () => {
  test('a new title: PATCH the transcript', async () => {
    const { client, sent } = setup()
    await client.updateTranscriptTitle(7, 'Weekly sync')
    expect(sent).toEqual([{ url: 'http://localhost:8000/transcripts/7', method: 'PATCH', body: { title: 'Weekly sync' } }])
  })

  test('an opened recording: POST its flag', async () => {
    const { client, sent } = setup()
    await client.markTranscriptOpened(7)
    expect(sent).toEqual([{ url: 'http://localhost:8000/transcripts/7/opened', method: 'POST' }])
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

describe('getAudioUrl', () => {
  const recording = (audio_path: string) => ({ id: 7, audio_path }) as Transcript

  test('the audio route of the recording', () => {
    expect(setup().client.getAudioUrl(recording('/home/u/Запись #1.wav'))).toBe('http://localhost:8000/transcripts/7/audio')
  })

  test('a recording with no audio has nothing to play', () => {
    expect(setup().client.getAudioUrl(recording(''))).toBeNull()
  })
})

describe('getSpeakerCandidates', () => {
  test('asks the candidates route and gives its answer as it is', async () => {
    const entry = {
      candidates: [{ speaker_id: 'm', name: 'Mark', score: 0.82, suggested: true }],
      clip: { start: 16, end: 20, text: 'That was me.' },
    }
    const { client, sent } = setup(() => json({ u1: entry }))
    await expect(client.getSpeakerCandidates(7)).resolves.toEqual({ u1: entry })
    expect(sent[0].url).toBe('http://localhost:8000/transcripts/7/speaker-candidates')
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

  test('now is the current time', () => {
    const before = Date.now()
    const now = createBackendClient().now().getTime()
    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(Date.now())
  })
})


describe('getWaveform', () => {
  test('asks for the bars of a stretch and answers their levels', async () => {
    const { client, sent } = setup(() => json({ levels: [0, 0.5, 1] }))
    await expect(client.getWaveform(7, { bars: 3, start: 0, end: 12.5 })).resolves.toEqual([0, 0.5, 1])
    expect(sent[0].url).toBe('http://localhost:8000/transcripts/7/waveform?bars=3&start=0&end=12.5')
    expect(sent[0].method).toBe('GET')
  })
})

describe('listModels', () => {
  test('asks GET /models and answers the catalog as it is', async () => {
    const models = [
      { id: 'small', kind: 'whisper', name: 'Whisper Small', size: '244 MB', speed: '', acc: '', recommended: false, installed: true },
      { id: 'ru', kind: 'alignment', installed: false },
    ]
    const { client, sent } = setup(() => json(models))
    await expect(client.listModels()).resolves.toEqual(models)
    expect(sent).toEqual([{ url: 'http://localhost:8000/models', method: 'GET', body: undefined }])
  })
})

describe('addQueueJob', () => {
  test('sends the file, the model and the language, and answers the job', async () => {
    const job = { id: 'j', audio_path: '/in/a.mp3', title: 'a', whisper_model: 'small', language: 'ru', status: 'waiting' }
    const { client, sent } = setup(() => json(job))
    await expect(client.addQueueJob({ audioPath: '/in/a.mp3', whisperModel: 'small', language: 'ru' })).resolves.toEqual(job)
    expect(sent).toEqual([{ url: 'http://localhost:8000/queue/jobs', method: 'POST', body: { audio_path: '/in/a.mp3', whisper_model: 'small', language: 'ru' } }])
  })

  test('leaves model and language to the backend as null, and no title: it takes the file name', async () => {
    const { client, sent } = setup(() => json({}))
    await client.addQueueJob({ audioPath: '/in/a.mp3', whisperModel: null, language: null })
    expect(sent[0].body).toEqual({ audio_path: '/in/a.mp3', whisper_model: null, language: null })
  })

  test('a title goes along when there is one', async () => {
    const { client, sent } = setup(() => json({}))
    await client.addQueueJob({ audioPath: '/in/a.mp3', whisperModel: null, language: null, title: 'Standup' })
    expect(sent[0].body).toEqual({ audio_path: '/in/a.mp3', whisper_model: null, language: null, title: 'Standup' })
  })

  test('a missing model is the 400 with its detail', async () => {
    const { client } = setup(() => json({ detail: 'Diarization model is not installed. Download it in Settings.' }, 400))
    await expect(client.addQueueJob({ audioPath: '/in/a.mp3', whisperModel: null, language: null }))
      .rejects.toMatchObject({ status: 400, message: 'Diarization model is not installed. Download it in Settings.' })
  })
})
