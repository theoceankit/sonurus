const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')

const { leastUsedColorIndex, hasSpeakerNamed, speakerAssignRequest } = loadRenderer(['utils.js'])

const plain = v => JSON.parse(JSON.stringify(v))

test('leastUsedColorIndex: first palette color no speaker uses', () => {
  assert.equal(leastUsedColorIndex([]), 0)
  assert.equal(leastUsedColorIndex([{ color_index: 0 }, { color_index: 1 }]), 2)
})

test('leastUsedColorIndex: all used → the least used one, lowest index on ties', () => {
  const rows = [0, 0, 1, 2, 2, 3, 4, 4].map(color_index => ({ color_index }))
  assert.equal(leastUsedColorIndex(rows), 1)
})

test('hasSpeakerNamed: ignores case and surrounding spaces', () => {
  const rows = [{ id: 'a', name: 'Alice Smith' }, { id: 'u', name: null }]
  assert.equal(hasSpeakerNamed(rows, '  alice SMITH '), true)
  assert.equal(hasSpeakerNamed(rows, 'Alice'), false)
  assert.equal(hasSpeakerNamed(rows, '   '), false)
})

test('speakerAssignRequest: one segment → PATCH segment speaker', () => {
  const byId = speakerAssignRequest({ transcriptId: 7, fromSpeakerId: 'x', segmentStart: 1.5, target: { id: 'b' } })
  assert.deepEqual(plain(byId), {
    url: 'http://localhost:8000/transcripts/7/segments/1.5/speaker',
    method: 'PATCH',
    body: { speaker_id: 'b' },
  })
  const byName = speakerAssignRequest({
    transcriptId: 7, fromSpeakerId: 'x', segmentStart: 0, target: { name: 'Dana', colorIndex: 3 },
  })
  assert.equal(byName.url, 'http://localhost:8000/transcripts/7/segments/0/speaker')
  assert.deepEqual(plain(byName.body), { speaker_name: 'Dana', color_index: 3 })
})

test('speakerAssignRequest: no segment → POST reassign of every segment of the speaker', () => {
  const byId = speakerAssignRequest({ transcriptId: 7, fromSpeakerId: 'x', segmentStart: null, target: { id: 'b' } })
  assert.deepEqual(plain(byId), {
    url: 'http://localhost:8000/transcripts/7/reassign',
    method: 'POST',
    body: { from_speaker_id: 'x', to_speaker_id: 'b' },
  })
  const byName = speakerAssignRequest({
    transcriptId: 7, fromSpeakerId: 'x', segmentStart: null, target: { name: 'Dana', colorIndex: 0 },
  })
  assert.deepEqual(plain(byName.body), { from_speaker_id: 'x', to_speaker_name: 'Dana', color_index: 0 })
})

test('speakerAssignRequest: color is omitted when not chosen', () => {
  const r = speakerAssignRequest({ transcriptId: 7, fromSpeakerId: 'x', segmentStart: null, target: { name: 'Dana' } })
  assert.deepEqual(plain(r.body), { from_speaker_id: 'x', to_speaker_name: 'Dana' })
})
