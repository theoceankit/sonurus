'use strict'

// The window opens the built UI (ui/dist), in development and packaged alike.
// Only development may load a dev server (npm run dev:ui).

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { uiEntry } = require(path.join(ROOT, 'electron', 'ui-entry.js'))

const ELECTRON_DIR = path.join(ROOT, 'electron')
const BUILT_UI = { file: path.join(ROOT, 'ui', 'dist', 'index.html') }
const DEV_URL = 'http://localhost:5173'

const entry = (isPackaged, devUrl) => uiEntry({ isPackaged, devUrl, electronDir: ELECTRON_DIR })

test('both modes open the built UI', () => {
  assert.deepEqual(entry(false, undefined), BUILT_UI)
  assert.deepEqual(entry(true, undefined), BUILT_UI)
})

test('development with a dev server URL opens the dev server', () => {
  assert.deepEqual(entry(false, DEV_URL), { url: DEV_URL })
})

test('the packaged app never loads a URL from the environment', () => {
  assert.deepEqual(entry(true, DEV_URL), BUILT_UI)
})

test('main.js takes the window content from uiEntry and keeps its security settings', () => {
  const main = fs.readFileSync(path.join(ELECTRON_DIR, 'main.js'), 'utf8')
  assert.match(main, /uiEntry\(\{/)
  assert.doesNotMatch(main, /new-ui|newUi/)
  assert.doesNotMatch(main, /'renderer'/)
  assert.match(main, /contextIsolation: true/)
  assert.match(main, /nodeIntegration: false/)
  assert.match(main, /sandbox: true/)
  assert.match(main, /'will-navigate', e => e\.preventDefault\(\)/)
})
