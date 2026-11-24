const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ELECTRON_DIR = path.join(__dirname, '..', '..', 'electron')
const read = rel => fs.readFileSync(path.join(ELECTRON_DIR, rel), 'utf8')

// The HuggingFace token reaches the backend only with a model download request
// (the UI sends the one from Settings), never at the backend's start.

test('the backend Electron starts gets no HF_TOKEN', () => {
  assert.doesNotMatch(read('backend.js'), /HF_TOKEN/)
})

test('startBackend and restartBackend take no token', () => {
  const backend = read('backend.js')
  assert.match(backend, /async function startBackend\(\)/)
  assert.match(backend, /async function restartBackend\(\)/)
})

test('the main process does not read the token from the settings', () => {
  const main = read('main.js')
  assert.doesNotMatch(main, /savedHfToken/)
  assert.doesNotMatch(main, /\.hfToken\b/)
})
