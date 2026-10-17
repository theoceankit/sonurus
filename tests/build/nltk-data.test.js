'use strict'

// WhisperX alignment splits sentences with NLTK's punkt_tab data. The installer
// build puts it into python-dist/nltk_data (scripts/fetch_nltk_data.py run by
// the bundled Python), so a built app aligns offline and never downloads it;
// the import check proves every language WhisperX uses loads from there.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT    = path.resolve(__dirname, '..', '..')
const imports = require(path.join(ROOT, 'scripts', 'check-bundled-imports.js'))

test('the bundle installs punkt_tab with the bundled Python, cached in backend-dist', () => {
  const src  = fs.readFileSync(path.join(ROOT, 'scripts', 'bundle-backend.js'), 'utf8')
  const main = src.slice(src.indexOf('async function main()'))
  assert.match(main, /run\(exe, \[path\.join\(ROOT, 'scripts', 'fetch_nltk_data\.py'\), '--cache', DEST\]\)/)
  // After pip: python-dist is re-extracted at the start of every run.
  assert.ok(main.indexOf('fetch_nltk_data.py') > main.indexOf("'-m', 'pip', 'install'"))
})

test('the installers leave the cached archive out', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const backend = pkg.build.extraResources.find(r => r.from === 'backend-dist/')
  assert.ok(backend.filter.includes('!*.zip'), 'backend-dist/*.zip must not ship')
})

test('the import check loads punkt_tab for every WhisperX language offline', () => {
  const src = imports.checkSource()
  assert.ok(src.includes('use_bundled_nltk_data()'), 'NLTK must be limited to the bundled data')
  assert.ok(src.includes('PUNKT_LANGUAGES'), 'every language WhisperX maps must be loaded')
  assert.ok(src.includes('tokenizers/punkt_tab/'), 'the data must be loaded the way WhisperX loads it')
})
