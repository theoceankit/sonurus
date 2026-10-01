// Settings → ML Models / Alignment Models rows. They are built inside a
// fetch().then() whose .catch() hides errors, so a throw here means an empty
// list in the app.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')
const { fakeElement } = require('./fake-dom')

const iconCalls = []
const ctx = loadRenderer(['data.js', 'views/settings-view.js'], {
  API_BASE: 'http://api',
  document: { createElement: () => fakeElement() },
  icon: (name, size) => { iconCalls.push(name); return `<span data-icon="${name}" data-size="${size}"></span>` },
})

const state = () => ({
  transcribeModel: 'small',
  modelStatus: { small: 'installed', 'large-v3': 'available', diarize: 'installed', ru: 'installed' },
  activeDownload: {}, modelProgress: {},
})
const noop = () => {}

for (const model of [
  { id: 'small', name: 'Whisper Small', kind: 'whisper', size: '244 MB', installed: true },
  { id: 'large-v3', name: 'Whisper Large v3', kind: 'whisper', size: '1.55 GB', installed: false },
  { id: 'diarize', name: 'Diarization · v2', kind: 'diarization', size: '130 MB', installed: true },
]) {
  test(`makeModelRow: builds the ${model.id} row`, () => {
    iconCalls.length = 0
    const row = ctx.makeModelRow(model, state(), noop, noop, noop)
    assert.equal(row.dataset.id, model.id)
    assert.ok(iconCalls.includes(model.kind === 'diarization' ? 'speakers' : 'waveform'))
  })
}

test('makeAlignmentModelRow: builds the row', () => {
  const row = ctx.makeAlignmentModelRow(
    { id: 'ru', kind: 'alignment', lang: 'ru', name: 'Russian', nativeName: 'Русский', size: '~1.3 GB' },
    state(), noop, noop)
  assert.equal(row.dataset.id, 'ru')
})

test('makeSectionHeader: builds the header', () => {
  assert.doesNotThrow(() => ctx.makeSectionHeader('<span></span>', 'ML Models', 'Whisper'))
})
