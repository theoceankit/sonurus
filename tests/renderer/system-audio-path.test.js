'use strict'

// System audio is captured by the backend on every OS (macOS helper, parec on
// Linux, WASAPI helper on Windows). The renderer-side Windows loopback path
// (getDisplayMedia + setDisplayMediaRequestHandler, source "__desktop__") is
// gone; this keeps it from coming back.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ELECTRON = path.resolve(__dirname, '..', '..', 'electron')

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'resources' ? [] : jsFiles(p)
    return e.name.endsWith('.js') ? [p] : []
  })
}

for (const needle of ['getDisplayMedia', 'setDisplayMediaRequestHandler', 'desktopCapturer', '__desktop__', "'display-capture'"]) {
  test(`electron/ no longer uses ${needle}`, () => {
    const hits = jsFiles(ELECTRON).filter(f => fs.readFileSync(f, 'utf8').includes(needle))
    assert.deepEqual(hits.map(f => path.relative(ELECTRON, f)), [])
  })
}

test('live recording asks the backend for system audio on every platform', () => {
  const src = fs.readFileSync(path.join(ELECTRON, 'renderer', 'app.js'), 'utf8')
  assert.ok(!/platform\s*!==\s*'win32'/.test(src), "no win32 special case left in app.js")
  assert.ok(src.includes('/audio/capture/start'))
})
