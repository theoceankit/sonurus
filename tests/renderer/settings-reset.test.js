const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')

const { defaultSettingsPatch, dataResetBlockReason, formatDataResetSummary } =
  loadRenderer(['utils.js'])

const plain = v => JSON.parse(JSON.stringify(v))

// ── defaultSettingsPatch ───────────────────────────────────────────────────────

test('defaultSettingsPatch: restores every default preference', () => {
  const defaults = { scale: 100, transcribeLang: 'auto', transcribeModel: 'small', hfToken: '' }
  const current  = { scale: 130, transcribeLang: 'ru',   transcribeModel: 'large-v3', hfToken: 'hf_x' }
  const patch = plain(defaultSettingsPatch(defaults, current))
  assert.equal(patch.scale, 100)
  assert.equal(patch.transcribeLang, 'auto')
  assert.equal(patch.transcribeModel, 'small')
})

test('defaultSettingsPatch: keeps the Hugging Face token', () => {
  const patch = defaultSettingsPatch({ scale: 100, hfToken: '' }, { scale: 90, hfToken: 'hf_x' })
  assert.equal(patch.hfToken, 'hf_x')
})

test('defaultSettingsPatch: does not mutate the defaults object', () => {
  const defaults = { scale: 100, hfToken: '' }
  defaultSettingsPatch(defaults, { scale: 90, hfToken: 'hf_x' })
  assert.deepEqual(plain(defaults), { scale: 100, hfToken: '' })
})

// ── dataResetBlockReason ───────────────────────────────────────────────────────

test('dataResetBlockReason: null when nothing is running', () => {
  assert.equal(dataResetBlockReason(0, null), null)
})

test('dataResetBlockReason: blocked while transcription jobs run', () => {
  assert.match(dataResetBlockReason(2, null), /transcription/i)
})

test('dataResetBlockReason: blocked while a live recording runs', () => {
  assert.match(dataResetBlockReason(0, { jobId: 'x' }), /recording/i)
})

// ── formatDataResetSummary ─────────────────────────────────────────────────────

test('formatDataResetSummary: plural counts', () => {
  assert.equal(
    formatDataResetSummary({ transcripts: 3, speakers: 2, files: 5 }),
    'Deleted 3 transcripts, 2 speakers and 5 files.',
  )
})

test('formatDataResetSummary: singular counts', () => {
  assert.equal(
    formatDataResetSummary({ transcripts: 1, speakers: 1, files: 1 }),
    'Deleted 1 transcript, 1 speaker and 1 file.',
  )
})

test('formatDataResetSummary: nothing to delete', () => {
  assert.equal(
    formatDataResetSummary({ transcripts: 0, speakers: 0, files: 0 }),
    'There was no data to delete.',
  )
})
