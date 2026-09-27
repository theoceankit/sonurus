const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')

const { withoutRecording, deleteTranscriptPrompt } = loadRenderer(['utils.js'])

const plain = v => JSON.parse(JSON.stringify(v))

test('withoutRecording: drops the item with that id', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }]
  assert.deepEqual(plain(withoutRecording(items, 2)), [{ id: 1 }, { id: 3 }])
})

test('withoutRecording: unknown id leaves the list unchanged', () => {
  assert.deepEqual(plain(withoutRecording([{ id: 1 }], 9)), [{ id: 1 }])
})

test('withoutRecording: does not mutate the input', () => {
  const items = [{ id: 1 }, { id: 2 }]
  withoutRecording(items, 1)
  assert.equal(items.length, 2)
})

test('deleteTranscriptPrompt: names the transcript', () => {
  const p = deleteTranscriptPrompt('Weekly sync')
  assert.equal(p.title, 'Delete “Weekly sync”?')
  assert.match(p.body, /cannot be undone/i)
})

test('deleteTranscriptPrompt: falls back for an empty title', () => {
  assert.equal(deleteTranscriptPrompt('').title, 'Delete this transcript?')
  assert.equal(deleteTranscriptPrompt(null).title, 'Delete this transcript?')
})
