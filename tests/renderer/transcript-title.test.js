const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')

const { titleToSave, transcriptTitleRequest } = loadRenderer(['utils.js'])

const plain = v => JSON.parse(JSON.stringify(v))

test('titleToSave: trims a changed title', () => {
  assert.equal(titleToSave('  Weekly sync ', 'Old'), 'Weekly sync')
})

test('titleToSave: empty or blank → nothing to save', () => {
  assert.equal(titleToSave('', 'Old'), null)
  assert.equal(titleToSave('   ', 'Old'), null)
})

test('titleToSave: unchanged (after trim) → nothing to save', () => {
  assert.equal(titleToSave(' Old ', 'Old'), null)
})

test('titleToSave: longer than 200 characters → nothing to save', () => {
  assert.equal(titleToSave('x'.repeat(201), 'Old'), null)
  assert.equal(titleToSave('x'.repeat(200), 'Old'), 'x'.repeat(200))
})

test('transcriptTitleRequest: PATCH /transcripts/{id} with the title', () => {
  assert.deepEqual(plain(transcriptTitleRequest(7, 'Weekly sync')), {
    url: 'http://localhost:8000/transcripts/7',
    method: 'PATCH',
    body: { title: 'Weekly sync' },
  })
})
