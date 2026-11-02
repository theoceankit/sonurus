'use strict'

// The new UI draws its own title bar over a window without a system frame. The
// old UI stays in releases until the cutover, so its window must not change.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { windowChrome } = require(path.join(ROOT, 'electron', 'window-chrome.js'))

const tokens = fs.readFileSync(path.join(ROOT, 'ui', 'src', 'styles', 'tokens.css'), 'utf8')
const token = name => tokens.match(new RegExp(`${name}:\\s*([^;]+);`))[1]

test('the old UI gets nothing: its window keeps the system frame', () => {
  assert.deepEqual(windowChrome({ newUi: false }), {})
})

test('the new UI hides the frame and keeps the system window buttons', () => {
  const chrome = windowChrome({ newUi: true })
  assert.equal(chrome.titleBarStyle, 'hidden')
  assert.ok(chrome.titleBarOverlay)
})

test('the window buttons match the title bar of the light theme', () => {
  const { titleBarOverlay, backgroundColor } = windowChrome({ newUi: true })
  assert.equal(token('--color-bg-sunken'), 'var(--gray-100)')
  assert.equal(titleBarOverlay.color, token('--gray-100'))
  assert.equal(backgroundColor, token('--gray-100'))
  assert.equal(titleBarOverlay.symbolColor, token('--gray-900'))
})

test('the window buttons are as high as the title bar', () => {
  assert.equal(`${windowChrome({ newUi: true }).titleBarOverlay.height}px`, token('--size-titlebar'))
})

test('main.js applies the chrome after its own settings and keeps the window size', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')
  assert.match(main, /minWidth:\s+900/)
  assert.match(main, /minHeight:\s+600/)
  assert.match(main, /backgroundColor: '#FFFFFF',[\s\S]*\.\.\.windowChrome\(\{ newUi \}\)[\s\S]*webPreferences/)
})
