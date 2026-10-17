'use strict'

// The Electron app makes no request to third parties on its own. Chromium's
// spell checker downloads Hunspell dictionaries from Google at start-up on
// Windows and Linux unless the session has no spell checker languages.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')

test('spell checking is off in the window and in the session', () => {
  const prefs = main.slice(main.indexOf('webPreferences: {'))
  assert.match(prefs.slice(0, prefs.indexOf('}')), /spellcheck:\s*false/)
  assert.match(main, /session\.defaultSession\.setSpellCheckerEnabled\(false\)/)
})

test('the session has no spell checker languages, so no dictionary is downloaded', () => {
  assert.match(main, /session\.defaultSession\.setSpellCheckerLanguages\(\[\]\)/)
  const ready = main.slice(main.indexOf('app.whenReady().then('))
  // Before anything else runs on ready: the window and the backend start later.
  assert.ok(ready.indexOf('setSpellCheckerLanguages([])') < ready.indexOf('startBackend('))
})

test('no crash reporter and no remote content in the app', () => {
  const sources = []
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'resources') walk(p) }
      else if (/\.(js|html|css)$/.test(e.name)) sources.push(p)
    }
  }
  walk(path.join(ROOT, 'electron'))
  for (const file of sources) {
    const src = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(src, /crashReporter/, file)
    // Only the local backend; the SVG namespace is an identifier, not a request.
    const urls = (src.match(/https?:\/\/[^\s'"`)]+/g) || [])
      .filter(u => !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u) && !u.startsWith('http://www.w3.org/'))
    assert.deepEqual(urls, [], file)
  }
})
