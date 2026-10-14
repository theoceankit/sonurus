const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')

const { transcriptLanguageLabel } = loadRenderer(['data.js', 'transcription-model.js'])

test('transcriptLanguageLabel: a known code → its name from the language list', () => {
  assert.equal(transcriptLanguageLabel('ru'), 'Русский')
  assert.equal(transcriptLanguageLabel('en'), 'English')
})

test('transcriptLanguageLabel: a code outside the list → the code itself', () => {
  assert.equal(transcriptLanguageLabel('xx'), 'xx')
})

test('transcriptLanguageLabel: unknown, auto or missing → no label', () => {
  for (const lang of ['unknown', 'Unknown', 'auto', '', null, undefined]) {
    assert.equal(transcriptLanguageLabel(lang), '')
  }
})
