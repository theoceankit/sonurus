const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')

const { fileUrl } = loadRenderer(['utils.js'])

// Values created inside the VM context have that realm's prototypes;
// normalise before deep comparisons.
const plain = v => JSON.parse(JSON.stringify(v))

test('fileUrl: plain POSIX path', () => {
  assert.equal(fileUrl('/home/u/rec.wav'), 'file:///home/u/rec.wav')
})

test('fileUrl: spaces and Cyrillic are percent-encoded', () => {
  assert.equal(
    fileUrl('/home/u/Запись 1.wav'),
    'file:///home/u/%D0%97%D0%B0%D0%BF%D0%B8%D1%81%D1%8C%201.wav',
  )
})

test('fileUrl: # and ? do not truncate the path', () => {
  assert.equal(fileUrl('/tmp/a#1?.wav'), 'file:///tmp/a%231%3F.wav')
})

test('fileUrl: Windows drive path', () => {
  assert.equal(fileUrl('C:\\Users\\a b\\x.wav'), 'file:///C:/Users/a%20b/x.wav')
})

test('fileUrl: result is stable under WHATWG URL normalisation', () => {
  // The editor compares against audio.src, which the browser normalises.
  for (const p of ['/home/u/Запись 1.wav', '/tmp/a#1?.wav', 'C:\\x y\\z.wav', "/a/(b)'c.wav"]) {
    assert.equal(new URL(fileUrl(p)).href, fileUrl(p))
  }
})

const { isUnrecognized } = loadRenderer(['utils.js'])

test('isUnrecognized: raw diarization labels are always unrecognized', () => {
  assert.equal(isUnrecognized('SPEAKER_00', { SPEAKER_00: { name: 'x' } }), true)
})

test('isUnrecognized: a UUID is recognized only when it is in the known map', () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  assert.equal(isUnrecognized(id, { [id]: { name: 'Alice' } }), false)
  assert.equal(isUnrecognized(id, {}), true)
})

test('isUnrecognized: without a known map every speaker is unrecognized', () => {
  // no legacy spk_* / "looks like a name" heuristics
  assert.equal(isUnrecognized('spk_123'), true)
  assert.equal(isUnrecognized('Alice'), true)
})

test('fileBaseName: POSIX and Windows paths', () => {
  const { fileBaseName } = loadRenderer(['utils.js'])
  assert.equal(fileBaseName('/home/u/Запись 1.wav'), 'Запись 1.wav')
  assert.equal(fileBaseName('C:\\Users\\u\\rec.webm'), 'rec.webm')
  assert.equal(fileBaseName(''), '')
})

test('listSystemAudioSources: every OS asks the backend (Windows included)', async () => {
  const urls = []
  const { listSystemAudioSources } = loadRenderer(['utils.js'], {
    fetch: async url => {
      urls.push(url)
      return {
        ok: url.endsWith('/audio/capture/sources'),
        json: async () => ({ sources: [
          { id: 'default', label: 'System audio (default)' },
          { id: '{0.0.0.00000000}.{h}', label: 'Headphones (USB)' },
        ] }),
      }
    },
  })
  assert.deepEqual(plain(await listSystemAudioSources()), [
    { value: 'default', label: 'System audio (default)' },
    { value: '{0.0.0.00000000}.{h}', label: 'Headphones (USB)' },
  ])
  assert.equal(urls.length, 1)
})

test('listSystemAudioSources: no renderer-side loopback inputs (Stereo Mix, VB-Cable)', async () => {
  const { listSystemAudioSources } = loadRenderer(['utils.js'], {
    fetch: async () => ({ ok: true, json: async () => ({ sources: [] }) }),
  })
  // Even if a caller still passes the mic inputs, they never become system sources.
  const inputs = [{ deviceId: 'vb', label: 'CABLE Output (VB-Audio Virtual Cable)' }]
  assert.deepEqual(plain(await listSystemAudioSources('win32', inputs)), [])
})

test('listSystemAudioSources: backend unreachable → empty list', async () => {
  const { listSystemAudioSources } = loadRenderer(['utils.js'], {
    fetch: async () => { throw new Error('ECONNREFUSED') },
  })
  assert.deepEqual(plain(await listSystemAudioSources()), [])
})

test('buildKnownMap: GET /speakers rows → { id: { name, colorIndex } }', () => {
  const { buildKnownMap } = loadRenderer(['utils.js'])
  const map = buildKnownMap([
    { id: 'a', name: 'Alice', color_index: 3 },
    { id: 'b', name: 'Bob' },
  ])
  assert.deepEqual(plain(map), { a: { name: 'Alice', colorIndex: 3 }, b: { name: 'Bob', colorIndex: 0 } })
})

test('uploadRecording: POSTs the blob to the backend and returns its path', async () => {
  const calls = []
  const { uploadRecording } = loadRenderer(['utils.js'], {
    fetch: async (url, opts) => {
      calls.push({ url, opts })
      return { ok: true, json: async () => ({ file_path: '/data/recordings/sonorus-rec-1.webm' }) }
    },
  })
  const blob = { type: 'audio/webm;codecs=opus' }
  assert.equal(await uploadRecording(blob), '/data/recordings/sonorus-rec-1.webm')
  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.endsWith('/audio/recordings'))
  assert.equal(calls[0].opts.method, 'POST')
  assert.equal(calls[0].opts.body, blob)
  assert.equal(calls[0].opts.headers['Content-Type'], 'audio/webm;codecs=opus')
})

test('uploadRecording: backend error → throws its detail', async () => {
  const { uploadRecording } = loadRenderer(['utils.js'], {
    fetch: async () => ({ ok: false, json: async () => ({ detail: 'The recording is empty' }) }),
  })
  await assert.rejects(uploadRecording({ type: 'audio/webm' }), /The recording is empty/)
})

// ── captureStartError ───────────────────────────────────────────────────────

const { captureStartError } = loadRenderer(['utils.js'])

test('captureStartError: macOS permission failure becomes the Screen Recording hint', () => {
  const msg = captureStartError('darwin', 'SCStream failed: TCC permission denied')
  assert.match(msg, /Screen Recording/)
})

test('captureStartError: Linux keeps the backend text, even with "denied" in it', () => {
  const detail = 'System audio capture failed to start: Connection failure: Access denied'
  assert.equal(captureStartError('linux', detail), detail)
})

test('captureStartError: other macOS errors pass through', () => {
  assert.equal(captureStartError('darwin', 'sonorus-capture timed out starting.'),
    'sonorus-capture timed out starting.')
})

test('captureStartError: empty detail gets a generic message', () => {
  assert.equal(captureStartError('linux', ''), 'Failed to start system audio capture.')
})
