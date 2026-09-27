const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')

const { defaultSettingsPatch } = loadRenderer(['utils.js'])

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
