// Importing from the New Recording modal: one or several files, by drop or
// from the file dialog. Shares the file rules and toasts with window drops.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')
const { fakeElement } = require('./fake-dom')
const { models, seedModels } = require('./models-fixture')

const plain = v => JSON.parse(JSON.stringify(v))
const pending = () => new Promise(() => {})
const flush = () => new Promise(resolve => setImmediate(resolve))

// ── Helpers (utils.js) ─────────────────────────────────────────────────────────

const { modalImportItems, importStartToast, skippedFilesToast } = loadRenderer(['utils.js'])

test('modalImportItems: one file keeps a typed title, trimmed', () => {
  assert.deepEqual(plain(modalImportItems(['/a/call.wav'], { title: '  Standup ', titleIsDefault: false })),
    { items: [{ filePath: '/a/call.wav', title: 'Standup' }], skipped: 0 })
})

test('modalImportItems: one file with the untouched default or a blank title → file name (null)', () => {
  assert.equal(modalImportItems(['/a/call.wav'], { title: '2 Oct 10:00 Meeting', titleIsDefault: true }).items[0].title, null)
  assert.equal(modalImportItems(['/a/call.wav'], { title: '   ', titleIsDefault: false }).items[0].title, null)
})

test('modalImportItems: several files are titled by their file names (null), in order', () => {
  assert.deepEqual(plain(modalImportItems(['/a/2.mp3', '/a/1.wav', '/a/3.m4a'], { title: 'Standup', titleIsDefault: false })),
    { items: [{ filePath: '/a/2.mp3', title: null }, { filePath: '/a/1.wav', title: null }, { filePath: '/a/3.m4a', title: null }], skipped: 0 })
})

test('modalImportItems: unsupported files are skipped and counted', () => {
  const r = plain(modalImportItems(['/a/notes.txt', '/a/call.wav', '/a/pic.png'], { title: 'Standup', titleIsDefault: false }))
  assert.deepEqual(r, { items: [{ filePath: '/a/call.wav', title: 'Standup' }], skipped: 2 })
  assert.deepEqual(plain(modalImportItems(['/a/notes.txt'], { title: '', titleIsDefault: true })), { items: [], skipped: 1 })
})

test('importStartToast / skippedFilesToast: the window drop texts', () => {
  assert.equal(importStartToast(['/a/call.wav']), 'Importing call.wav…')
  assert.equal(importStartToast(['/a/1.wav', '/a/2.wav']), 'Importing 2 files…')
  assert.equal(skippedFilesToast(1), 'Skipped 1 unsupported file')
  assert.equal(skippedFilesToast(3), 'Skipped 3 unsupported files')
})

// ── Modal (fake DOM) ───────────────────────────────────────────────────────────

function openModal({ dialogPaths = [] } = {}) {
  const created = []
  const toasts = []
  const calls = []
  let closed = 0
  const ctx = loadRenderer(['utils.js', 'data.js', 'transcription-model.js', 'views/new-recording-modal.js'], {
    appSettings: { transcribeModel: 'large-v3', transcribeLang: 'ru' },
    document: {
      createElement: () => fakeElement(created),
      addEventListener() {},
      removeEventListener: () => { closed++ },
    },
    window: {
      electronAPI: {
        getPlatform: pending,
        openFiles: async () => dialogPaths,
        getFilePath: file => file.path,
      },
      showToast: text => toasts.push(text),
    },
    navigator: {},
    fetch: pending,
    setTimeout,
    icon: () => '',
    markNotImplemented() {},
    saveSettings() {},
    makeDropdown: () => fakeElement(created),
  })
  seedModels(ctx, models())
  ctx.renderNewRecordingModal({ onStart() {}, onImport: args => calls.push(plain(args)) })
  const el = cls => created.find(e => e.className === cls)
  const drop = files => el('nr-modal').fire('drop', {
    preventDefault() {},
    dataTransfer: { files: files.map(p => ({ name: p.split('/').pop(), path: p })) },
  })
  return { calls, toasts, el, drop, closed: () => closed }
}

test('Modal drop: every supported file is imported in drop order; unsupported skipped with a toast', () => {
  const m = openModal()
  m.drop(['/a/2.mp3', '/a/notes.txt', '/a/1.wav'])
  assert.deepEqual(m.calls, [{
    items: [{ filePath: '/a/2.mp3', title: null }, { filePath: '/a/1.wav', title: null }],
    model: 'large-v3', language: 'ru',
  }])
  assert.deepEqual(m.toasts, ['Skipped 1 unsupported file'])
  assert.equal(m.closed(), 1)
})

test('Modal drop: only unsupported files → nothing imported, the modal stays open', () => {
  const m = openModal()
  m.drop(['/a/notes.txt', '/a/pic.png'])
  assert.deepEqual(m.calls, [])
  assert.deepEqual(m.toasts, ['Skipped 2 unsupported files'])
  assert.equal(m.closed(), 0)
})

test('Modal drop: one file with the untouched default title → file name', () => {
  const m = openModal()
  m.drop(['/a/call.wav'])
  assert.deepEqual(m.calls[0].items, [{ filePath: '/a/call.wav', title: null }])
})

test('Modal import button: several files from the dialog', async () => {
  const m = openModal({ dialogPaths: ['/a/1.wav', '/a/2.wav', '/a/3.wav'] })
  m.el('nr-import-btn').fire('click')
  await flush()
  assert.equal(m.calls.length, 1)
  assert.deepEqual(m.calls[0].items.map(i => i.filePath), ['/a/1.wav', '/a/2.wav', '/a/3.wav'])
  assert.ok(m.calls[0].items.every(i => i.title === null))
  assert.equal(m.closed(), 1)
})

test('Modal import button: one file with a typed title keeps it', async () => {
  const m = openModal({ dialogPaths: ['/a/call.wav'] })
  const title = m.el('nr-title-input')
  title.removeAttribute('data-default')
  title.value = 'Weekly sync'
  m.el('nr-import-btn').fire('click')
  await flush()
  assert.deepEqual(m.calls[0].items, [{ filePath: '/a/call.wav', title: 'Weekly sync' }])
})

test('Modal import button: one file with the untouched default title → file name', async () => {
  const m = openModal({ dialogPaths: ['/a/call.wav'] })
  m.el('nr-import-btn').fire('click')
  await flush()
  assert.deepEqual(m.calls[0].items, [{ filePath: '/a/call.wav', title: null }])
})

test('Modal import button: a cancelled dialog does nothing', async () => {
  const m = openModal({ dialogPaths: [] })
  m.el('nr-import-btn').fire('click')
  await flush()
  assert.deepEqual(m.calls, [])
  assert.equal(m.closed(), 0)
})
