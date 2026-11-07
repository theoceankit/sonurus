import { describe, expect, test, vi } from 'vitest'
import type { ApiClient } from '../api/client'
import { BROKEN_SOURCE, BROKEN_SOURCE_ERROR, createFixtureClient } from '../api/fixtures/fixture-client'
import { startRecording, type RecordingRequest, type SessionDeps } from './session'

const LOGGED = ['startQueueRecording', 'stopQueueRecording', 'startCapture', 'stopCapture', 'uploadRecording', 'addQueueJob'] as const

// A fixture backend that writes down each recording call, with its arguments.
function backend(overrides: Partial<ApiClient> = {}) {
  const calls: [string, ...unknown[]][] = []
  const client = createFixtureClient({ overrides })
  for (const name of LOGGED) {
    const method = client[name] as (...args: unknown[]) => Promise<unknown>
    ;(client as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      calls.push([name, ...args])
      return method(...args)
    }
  }
  return { client, calls, names: () => calls.map(([name]) => name) }
}

// The window's audio, faked: a microphone stream, the graph it goes through and a
// recorder that hands over one chunk when it stops.
function media({ micRefused = false } = {}) {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  const graph = { stream, close: vi.fn() }
  const recorders: { started: number | null; stopped: boolean }[] = []
  const deps = {
    platform: async () => 'linux',
    getUserMedia: vi.fn(async () => {
      if (micRefused) throw new DOMException('Permission denied', 'NotAllowedError')
      return stream
    }),
    connect: vi.fn(() => graph),
    createRecorder: vi.fn(() => {
      const state = { started: null as number | null, stopped: false }
      recorders.push(state)
      const recorder = {
        ondataavailable: null as ((event: { data: Blob }) => void) | null,
        onstop: null as (() => void) | null,
        start: (slice: number) => { state.started = slice },
        stop: () => {
          state.stopped = true
          recorder.ondataavailable?.({ data: new Blob(['opus'], { type: 'audio/webm' }) })
          setTimeout(() => recorder.onstop?.())
        },
      }
      return recorder
    }),
  }
  return { deps, track, graph, recorders }
}

const REQUEST: RecordingRequest = {
  mic: true, micDeviceId: null, system: true, systemSourceId: '@DEFAULT_MONITOR@', title: '7 Nov 18:30 Meeting', model: 'small', language: null,
}

const run = (request: Partial<RecordingRequest>, api = backend(), audio = media()) => {
  const deps: SessionDeps = { api: api.client, ...audio.deps }
  return { api, audio, started: startRecording({ ...REQUEST, ...request }, deps) }
}

describe('microphone and system audio', () => {
  test('the queue pauses, the backend captures system audio and the window records the microphone', async () => {
    const { api, audio, started } = run({ micDeviceId: 'maono' })
    await started
    expect(api.names()).toEqual(['startQueueRecording', 'startCapture'])
    expect(api.calls[1]).toEqual(['startCapture', '@DEFAULT_MONITOR@'])
    expect(audio.deps.getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'maono' } } })
    expect(audio.recorders).toEqual([{ started: 1000, stopped: false }])
  })

  test('stop: the microphone is uploaded, mixed in by the backend, queued, and the queue is let go last', async () => {
    const { api, audio, started } = run({})
    await (await started).stop()
    expect(api.names()).toEqual(['startQueueRecording', 'startCapture', 'uploadRecording', 'stopCapture', 'addQueueJob', 'stopQueueRecording'])
    const [, , micPath] = api.calls.find(([name]) => name === 'stopCapture')!
    expect(micPath).toMatch(/\.webm$/)
    expect(api.calls.find(([name]) => name === 'addQueueJob')![1]).toMatchObject({ audioPath: expect.stringMatching(/\.wav$/), title: '7 Nov 18:30 Meeting', whisperModel: 'small', language: null })
    expect(audio.track.stop).toHaveBeenCalled()
    expect(audio.graph.close).toHaveBeenCalled()
  })
})

test('system audio alone: no microphone is opened; stop queues the captured file', async () => {
  const { api, audio, started } = run({ mic: false })
  await (await started).stop()
  expect(audio.deps.getUserMedia).not.toHaveBeenCalled()
  expect(audio.recorders).toHaveLength(0)
  expect(api.names()).toEqual(['startQueueRecording', 'startCapture', 'stopCapture', 'addQueueJob', 'stopQueueRecording'])
  expect(api.calls.find(([name]) => name === 'stopCapture')).toHaveLength(2)
})

test('the microphone alone: no capture; stop uploads the recording and queues it', async () => {
  const { api, audio, started } = run({ system: false })
  await (await started).stop()
  expect(audio.deps.getUserMedia).toHaveBeenCalledWith({ audio: true })
  expect(api.names()).toEqual(['startQueueRecording', 'uploadRecording', 'addQueueJob', 'stopQueueRecording'])
  expect(api.calls.at(-2)![1]).toMatchObject({ audioPath: expect.stringMatching(/\.webm$/) })
})

describe('when it cannot start', () => {
  test('a refused capture: the microphone is let go, the queue is let go, and the reason comes out', async () => {
    const { api, audio, started } = run({ systemSourceId: BROKEN_SOURCE })
    await expect(started).rejects.toThrow(BROKEN_SOURCE_ERROR)
    expect(audio.track.stop).toHaveBeenCalled()
    expect(api.names()).toEqual(['startQueueRecording', 'startCapture', 'stopQueueRecording'])
  })

  test('a refused microphone: the microphone opens first, so no capture is started', async () => {
    const api = backend()
    const { started } = run({}, api, media({ micRefused: true }))
    await expect(started).rejects.toThrow('Permission denied')
    expect(api.names()).toEqual(['startQueueRecording', 'stopQueueRecording'])
  })

  test('a refused capture after the microphone opened: the capture is not left running', async () => {
    const api = backend()
    const audio = media()
    audio.deps.connect = vi.fn(() => { throw new Error('No audio context') })
    const { started } = run({}, api, audio)
    await expect(started).rejects.toThrow('No audio context')
    await vi.waitFor(() => expect(api.names()).toEqual(['startQueueRecording', 'startCapture', 'stopCapture', 'stopQueueRecording']))
  })

  test('nothing to record: neither source', async () => {
    const { api, started } = run({ mic: false, system: false })
    await expect(started).rejects.toThrow('No audio source available. Check device permissions.')
    expect(api.names()).toEqual(['startQueueRecording', 'stopQueueRecording'])
  })

  test('system audio is asked of the backend on every platform; macOS gets a hint for its permission', async () => {
    const audio = media()
    audio.deps.platform = async () => 'darwin'
    const api = backend({ startCapture: () => Promise.reject(new Error('SCStream: permission denied')) })
    const { started } = run({ mic: false }, api, audio)
    await expect(started).rejects.toThrow(/^Screen Recording access is required/)
  })
})

describe('when it cannot stop', () => {
  test('a failed mix comes out as an error, nothing is queued, and the queue is still let go', async () => {
    const api = backend({ stopCapture: () => Promise.reject(new Error('ffmpeg failed')) })
    const { started } = run({}, api)
    const live = await started
    await expect(live.stop()).rejects.toThrow('ffmpeg failed')
    expect(api.names().at(-1)).toBe('stopQueueRecording')
    expect(api.names()).not.toContain('addQueueJob')
  })

  test('a second stop does nothing', async () => {
    const { api, started } = run({ system: false })
    const live = await started
    await Promise.all([live.stop(), live.stop()])
    expect(api.names().filter(name => name === 'addQueueJob')).toHaveLength(1)
  })
})
