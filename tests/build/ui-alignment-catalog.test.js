'use strict'

// The UI names the alignment models itself (GET /models gives them an id and
// a size), so its list must be the backend catalog: a model missing from it
// could not be offered, one too many would never install.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')

// One line per model in ALIGNMENT_CATALOG: "ru": {"hf_repo": "…", "size_bytes": 1_262_000_000},
function backendCatalog() {
  const source = fs.readFileSync(path.join(ROOT, 'app', 'services', 'model_service.py'), 'utf8')
  const catalog = source.slice(source.indexOf('ALIGNMENT_CATALOG = {'))
  const lines = catalog.slice(0, catalog.indexOf('\n}\n')).split('\n').slice(1).filter(line => line.trim())
  return lines.map(line => {
    const match = line.match(/^\s+"(\w+)": \{/)
    assert.ok(match, `a catalog line this test cannot read: ${line.trim()}`)
    return { id: match[1] }
  })
}

function uiCatalog() {
  const source = fs.readFileSync(path.join(ROOT, 'ui', 'src', 'transcribe', 'languages.ts'), 'utf8')
  const list = source.slice(source.indexOf('export const ALIGNMENT_MODELS'))
  return [...list.slice(0, list.indexOf('\n]\n')).matchAll(/\{ id: '(\w+)'/g)].map(m => ({ id: m[1] }))
}

test('the UI alignment models are the backend ALIGNMENT_CATALOG, in its order', () => {
  const backend = backendCatalog()
  assert.ok(backend.length > 0)
  assert.deepEqual(uiCatalog().map(m => m.id), backend.map(m => m.id))
})
