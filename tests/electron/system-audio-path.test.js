'use strict'

// System audio is captured by the backend on every OS (macOS helper, parec on
// Linux, WASAPI helper on Windows). The window-side Windows loopback path
// (getDisplayMedia + setDisplayMediaRequestHandler, source "__desktop__") is
// gone; this keeps it from coming back in Electron or in the UI.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'resources' ? [] : sourceFiles(p)
    return /\.(js|ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
  })
}

for (const needle of ['getDisplayMedia', 'setDisplayMediaRequestHandler', 'desktopCapturer', '__desktop__', "'display-capture'"]) {
  test(`electron/ and ui/src no longer use ${needle}`, () => {
    const files = [...sourceFiles(path.join(ROOT, 'electron')), ...sourceFiles(path.join(ROOT, 'ui', 'src'))]
    const hits = files.filter(f => fs.readFileSync(f, 'utf8').includes(needle))
    assert.deepEqual(hits.map(f => path.relative(ROOT, f)), [])
  })
}
