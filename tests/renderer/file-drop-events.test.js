const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')

// Minimal window/document for file-drop.js: listeners, the overlay element
// and #main-panel's rect.
function setup(state = {}) {
  const listeners = {}
  const classes = new Set()
  const overlay = {
    className: '', innerHTML: '', style: {},
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    },
    querySelector: () => ({ textContent: '' }),
  }
  const window = {
    addEventListener: (type, fn) => { listeners[type] = fn },
    electronAPI: { getFilePath: file => `/in/${file.name}` },
  }
  const document = {
    createElement: () => overlay,
    body: { appendChild() {} },
    getElementById: () => ({ getBoundingClientRect: () => ({ top: 0, left: 0, width: 10, height: 10 }) }),
  }
  const ctx = loadRenderer(['utils.js', 'file-drop.js'], { window, document, icon: () => '' })
  const drops = []
  ctx.initFileDrop({
    getState: () => ({ view: 'import', recording: false, modalOpen: false, ...state }),
    onDrop: d => drops.push(JSON.parse(JSON.stringify(d))),
  })
  const fire = (type, { files = ['a.mp3'], types = ['Files'], prevented = false } = {}) => {
    const ev = {
      defaultPrevented: prevented,
      dataTransfer: { types, files: files.map(name => ({ name })), dropEffect: 'none' },
      preventDefault() { this.defaultPrevented = true },
    }
    listeners[type](ev)
    return ev
  }
  return { fire, drops, active: () => classes.has('fd-overlay--active') }
}

test('drop of files → onDrop with the decision, overlay hidden', () => {
  const { fire, drops, active } = setup()
  fire('dragenter')
  assert.equal(active(), true)
  const ev = fire('drop', { files: ['a.mp3', 'b.txt'] })
  assert.equal(ev.defaultPrevented, true)
  assert.equal(active(), false)
  assert.deepEqual(drops, [{ action: 'import', files: [{ name: 'a.mp3', path: '/in/a.mp3' }], skipped: 1 }])
})

test('drop already handled by a drop zone below (modal) → not imported again', () => {
  const { fire, drops, active } = setup()
  fire('dragenter')
  fire('drop', { prevented: true })
  assert.deepEqual(drops, [])
  assert.equal(active(), false)
})

test('after a handled drop the next drag shows the overlay again', () => {
  const { fire, active } = setup()
  fire('dragenter')
  fire('dragenter') // entered a child element
  fire('drop', { prevented: true })
  fire('dragenter')
  assert.equal(active(), true)
})

test('drags without files are left alone', () => {
  const { fire, drops, active } = setup()
  assert.equal(fire('dragenter', { types: ['text/plain'] }).defaultPrevented, false)
  assert.equal(fire('dragover', { types: ['text/plain'] }).defaultPrevented, false)
  assert.equal(fire('drop', { types: ['text/plain'] }).defaultPrevented, false)
  assert.equal(active(), false)
  assert.deepEqual(drops, [])
})

test('settings: no overlay, drop effect none, drop still cancelled', () => {
  const { fire, drops, active } = setup({ view: 'settings' })
  fire('dragenter')
  assert.equal(active(), false)
  const over = fire('dragover')
  assert.equal(over.defaultPrevented, true)
  assert.equal(over.dataTransfer.dropEffect, 'none')
  assert.equal(fire('drop').defaultPrevented, true)
  assert.deepEqual(drops, [{ action: 'ignore' }])
})

test('home: drop effect copy', () => {
  const { fire } = setup()
  assert.equal(fire('dragover').dataTransfer.dropEffect, 'copy')
})
