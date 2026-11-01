'use strict'

// The new UI lives next to the old one (ui/): a hidden --new-ui switch opens
// it, in the packaged app too, so a build can be checked before the cutover.
// Everyone else keeps the old UI, and only development may load a dev server.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { uiEntry } = require(path.join(ROOT, 'electron', 'ui-entry.js'))

const ELECTRON_DIR = path.join(ROOT, 'electron')
const OLD_UI = { file: path.join(ELECTRON_DIR, 'renderer', 'index.html') }
const NEW_UI = { file: path.join(ROOT, 'ui', 'dist', 'index.html') }
const DEV_URL = 'http://localhost:5173'

const entry = (isPackaged, newUi, devUrl) => uiEntry({ isPackaged, newUi, devUrl, electronDir: ELECTRON_DIR })

test('without the switch both modes open the old UI, whatever the environment says', () => {
  assert.deepEqual(entry(false, false, undefined), OLD_UI)
  assert.deepEqual(entry(true, false, undefined), OLD_UI)
  assert.deepEqual(entry(false, false, DEV_URL), OLD_UI)
  assert.deepEqual(entry(true, false, DEV_URL), OLD_UI)
})

test('the switch opens the built new UI', () => {
  assert.deepEqual(entry(false, true, undefined), NEW_UI)
  assert.deepEqual(entry(true, true, undefined), NEW_UI)
})

test('development with a dev server URL opens the dev server', () => {
  assert.deepEqual(entry(false, true, DEV_URL), { url: DEV_URL })
})

test('the packaged app never loads a URL from the environment', () => {
  assert.deepEqual(entry(true, true, DEV_URL), NEW_UI)
})

test('main.js takes the window content from uiEntry and keeps its security settings', () => {
  const main = fs.readFileSync(path.join(ELECTRON_DIR, 'main.js'), 'utf8')
  assert.match(main, /uiEntry\(\{/)
  assert.match(main, /hasSwitch\('new-ui'\)/)
  assert.doesNotMatch(main, /loadFile\(path\.join\(__dirname, 'renderer'/)
  assert.match(main, /contextIsolation: true/)
  assert.match(main, /nodeIntegration: false/)
  assert.match(main, /sandbox: true/)
  assert.match(main, /'will-navigate', e => e\.preventDefault\(\)/)
})
