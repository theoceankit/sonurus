const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')

const {
  buildKnownMap, effectiveSpeaker, filterSpeakers, duplicateNameIds,
  speakerDisplayName, speakerStatsLine, deleteSpeakerPrompt,
} = loadRenderer(['utils.js'])

const plain = v => JSON.parse(JSON.stringify(v))
const ids = rows => rows.map(r => r.id)

const ROWS = [
  { id: 'a', name: 'Alice Smith', color_index: 1 },
  { id: 'b', name: 'Bob', color_index: 2 },
  { id: 'u', name: null, color_index: 0 },
]

test('buildKnownMap: skips unnamed speakers', () => {
  assert.deepEqual(Object.keys(buildKnownMap(ROWS)), ['a', 'b'])
})

test('effectiveSpeaker: unassigned segment wins over every speaker field', () => {
  const seg = { unassigned: true, speaker_final: null, speaker_resolved: null, speaker_raw: 'SPEAKER_00' }
  assert.equal(effectiveSpeaker(seg), 'UNASSIGNED')  // API contract
  assert.equal(effectiveSpeaker({ ...seg, unassigned: false }), 'SPEAKER_00')
})

test('filterSpeakers: named / unnamed / all', () => {
  assert.deepEqual(ids(filterSpeakers(ROWS, '', 'all')), ['a', 'b', 'u'])
  assert.deepEqual(ids(filterSpeakers(ROWS, '', 'named')), ['a', 'b'])
  assert.deepEqual(ids(filterSpeakers(ROWS, '', 'unnamed')), ['u'])
})

test('filterSpeakers: query matches any part of the name, case-insensitively', () => {
  assert.deepEqual(ids(filterSpeakers(ROWS, '  SMI ', 'all')), ['a'])
  assert.deepEqual(ids(filterSpeakers(ROWS, 'zzz', 'all')), [])
})

test('filterSpeakers: unnamed speakers never match a non-empty query', () => {
  assert.deepEqual(ids(filterSpeakers(ROWS, 'unnamed', 'unnamed')), [])
})

test('duplicateNameIds: flags names that differ only by case or spaces', () => {
  const rows = [...ROWS, { id: 'a2', name: ' alice smith', color_index: 0 }]
  assert.deepEqual([...duplicateNameIds(rows)].sort(), ['a', 'a2'])
  assert.equal(duplicateNameIds(ROWS).size, 0)
})

test('speakerDisplayName: falls back for unnamed speakers', () => {
  assert.equal(speakerDisplayName(ROWS[0]), 'Alice Smith')
  assert.equal(speakerDisplayName(ROWS[2]), 'Unnamed speaker')
})

test('speakerStatsLine: transcripts and speaking time', () => {
  assert.equal(speakerStatsLine({ transcripts: 1, duration_sec: 75 }), '1 transcript · 01:15')
  assert.equal(speakerStatsLine({ transcripts: 3, duration_sec: 0 }), '3 transcripts · 00:00')
  assert.equal(speakerStatsLine({ transcripts: 0, duration_sec: 0 }), 'Not in any transcript')
})

test('deleteSpeakerPrompt: names the speaker and the affected segments', () => {
  const p = plain(deleteSpeakerPrompt({ name: 'Bob', segments: 12, transcripts: 3 }))
  assert.equal(p.title, 'Delete “Bob”?')
  assert.match(p.body, /12 segments in 3 transcripts will become Unassigned/)
  assert.match(p.body, /cannot be undone/i)
})

test('deleteSpeakerPrompt: unnamed speaker without segments', () => {
  const p = plain(deleteSpeakerPrompt({ name: null, segments: 0, transcripts: 0 }))
  assert.equal(p.title, 'Delete this speaker?')
  assert.doesNotMatch(p.body, /Unassigned/)
})

test('deleteSpeakerPrompt: singular forms', () => {
  const p = plain(deleteSpeakerPrompt({ name: 'Bob', segments: 1, transcripts: 1 }))
  assert.match(p.body, /1 segment in 1 transcript will become Unassigned/)
})
