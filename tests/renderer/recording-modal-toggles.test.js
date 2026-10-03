// Toggles of the New Recording modal. "Save audio file" is gone: a recording
// is always kept (the player, voice samples and Retry need it), so the modal
// neither shows the toggle nor reads or writes `recordingSaveAudio`.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadRenderer } = require('./load-renderer')
const { fakeElement } = require('./fake-dom')
const { models, seedModels } = require('./models-fixture')

const RENDERER_DIR = path.join(__dirname, '..', '..', 'electron', 'renderer')
const plain = v => JSON.parse(JSON.stringify(v))
const pending = () => new Promise(() => {})

function openModal(appSettings = {}) {
  const created = []
  const started = []
  const saved = []
  const ctx = loadRenderer(['utils.js', 'data.js', 'transcription-model.js', 'views/new-recording-modal.js'], {
    appSettings: { transcribeModel: 'large-v3', transcribeLang: 'ru', ...appSettings },
    document: {
      createElement: () => fakeElement(created),
      addEventListener() {},
      removeEventListener() {},
    },
    window: {
      electronAPI: { getPlatform: pending, openFiles: pending, getFilePath: file => file.path },
      showToast() {},
    },
    navigator: {},
    fetch: pending,
    setTimeout,
    icon: () => '',
    markNotImplemented() {},
    saveSettings: patch => saved.push(plain(patch)),
    makeDropdown: () => fakeElement(created),
  })
  seedModels(ctx, models())
  ctx.renderNewRecordingModal({ onStart: s => started.push(plain(s)), onImport() {} })
  const toggles = created.filter(e => e.className === 'nr-toggle')
  const start = () => created.find(e => e.className === 'nr-start-btn').fire('click')
  return { toggles, start, started, saved }
}

test('Recording modal: the only toggle is "Diarize speakers"', () => {
  const m = openModal()
  assert.equal(m.toggles.length, 1)
  assert.match(m.toggles[0].innerHTML, /Diarize speakers/)
  assert.doesNotMatch(m.toggles[0].innerHTML, /Save audio/)
})

test('Recording modal: Start passes and saves no saveAudio setting; diarize is kept', () => {
  const m = openModal()
  m.start()
  assert.equal(m.started.length, 1)
  assert.ok(!('saveAudio' in m.started[0]))
  assert.equal(m.started[0].diarize, true)
  assert.equal(m.saved.length, 1)
  assert.ok(!('recordingSaveAudio' in m.saved[0]))
  assert.equal(m.saved[0].recordingDiarize, true)
})

test('Recording modal: an old recordingSaveAudio in settings.json is ignored', () => {
  const m = openModal({ recordingSaveAudio: false })
  assert.equal(m.toggles.length, 1)
  m.start()
  assert.ok(!('saveAudio' in m.started[0]))
  assert.ok(!('recordingSaveAudio' in m.saved[0]))
})

test('No renderer source mentions recordingSaveAudio', () => {
  const offenders = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.(js|html)$/.test(entry.name) && fs.readFileSync(p, 'utf8').includes('recordingSaveAudio')) {
        offenders.push(path.relative(RENDERER_DIR, p))
      }
    }
  }
  walk(RENDERER_DIR)
  assert.deepEqual(offenders, [])
})
