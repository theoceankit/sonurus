const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')

const { isSupportedAudio, dropDecision, importRequest } = loadRenderer(['utils.js'])

const plain = v => JSON.parse(JSON.stringify(v))
const f = name => ({ name, path: `/in/${name}` })

test('isSupportedAudio: accepts the file dialog extensions, any case', () => {
  for (const ext of ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'mp4', 'mkv', 'webm'])
    assert.equal(isSupportedAudio(`call.${ext}`), true, ext)
  assert.equal(isSupportedAudio('CALL.MP3'), true)
  assert.equal(isSupportedAudio('my.meeting.final.Wav'), true)
})

test('isSupportedAudio: rejects other files', () => {
  assert.equal(isSupportedAudio('notes.txt'), false)
  assert.equal(isSupportedAudio('mp3'), false)
  assert.equal(isSupportedAudio('archive.mp3.zip'), false)
  assert.equal(isSupportedAudio(''), false)
  assert.equal(isSupportedAudio(undefined), false)
})

test('dropDecision: home and editor import the supported files in order', () => {
  for (const view of ['import', 'editor']) {
    const d = dropDecision({ view, recording: false, modalOpen: false, files: [f('a.mp3'), f('b.wav')] })
    assert.deepEqual(plain(d), { action: 'import', files: [f('a.mp3'), f('b.wav')], skipped: 0 }, view)
  }
})

test('dropDecision: unsupported files are skipped and counted', () => {
  const d = dropDecision({ view: 'import', recording: false, modalOpen: false,
    files: [f('a.txt'), f('b.mp3'), f('c.pdf')] })
  assert.deepEqual(plain(d), { action: 'import', files: [f('b.mp3')], skipped: 2 })
})

test('dropDecision: only unsupported files → import nothing, report skipped', () => {
  const d = dropDecision({ view: 'import', recording: false, modalOpen: false, files: [f('a.txt')] })
  assert.deepEqual(plain(d), { action: 'import', files: [], skipped: 1 })
})

test('dropDecision: settings and speakers ignore drops', () => {
  for (const view of ['settings', 'speakers']) {
    const d = dropDecision({ view, recording: false, modalOpen: false, files: [f('a.mp3')] })
    assert.equal(d.action, 'ignore', view)
  }
})

test('dropDecision: an open modal handles (or ignores) the drop itself', () => {
  const d = dropDecision({ view: 'import', recording: false, modalOpen: true, files: [f('a.mp3')] })
  assert.equal(d.action, 'ignore')
})

test('dropDecision: blocked while a live recording runs', () => {
  const d = dropDecision({ view: 'editor', recording: true, modalOpen: false, files: [f('a.mp3')] })
  assert.equal(d.action, 'blocked')
})

test('dropDecision: settings stays ignored even while recording', () => {
  const d = dropDecision({ view: 'settings', recording: true, modalOpen: false, files: [f('a.mp3')] })
  assert.equal(d.action, 'ignore')
})

test('importRequest: POST /transcribe with model, language and title', () => {
  assert.deepEqual(plain(importRequest('/in/a.mp3', { model: 'small', language: 'ru', title: 'Sync' })), {
    url: 'http://localhost:8000/transcribe',
    method: 'POST',
    body: { audio_path: '/in/a.mp3', whisper_model: 'small', language: 'ru', title: 'Sync' },
  })
})

test('importRequest: auto language and no title → null (backend detects / uses file name)', () => {
  assert.deepEqual(plain(importRequest('/in/a.mp3', { model: 'large-v3', language: 'auto' })).body, {
    audio_path: '/in/a.mp3', whisper_model: 'large-v3', language: null, title: null,
  })
})

test('importRequest: blank title → null', () => {
  assert.equal(importRequest('/in/a.mp3', { model: 'tiny', language: 'en', title: '   ' }).body.title, null)
})
