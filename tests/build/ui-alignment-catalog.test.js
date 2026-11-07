'use strict'

// The new UI names the alignment models itself (GET /models gives them only an
// id), so its list must be the backend catalog: a model missing from it could
// not be offered, one too many would never install.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')

function backendIds() {
  const source = fs.readFileSync(path.join(ROOT, 'app', 'services', 'model_service.py'), 'utf8')
  const catalog = source.slice(source.indexOf('ALIGNMENT_CATALOG = {'))
  return [...catalog.slice(0, catalog.indexOf('\n}\n')).matchAll(/^\s+"(\w+)":/gm)].map(m => m[1])
}

function uiIds() {
  const source = fs.readFileSync(path.join(ROOT, 'ui', 'src', 'transcribe', 'languages.ts'), 'utf8')
  const list = source.slice(source.indexOf('export const ALIGNMENT_MODELS'))
  return [...list.slice(0, list.indexOf('\n]\n')).matchAll(/\{ id: '(\w+)'/g)].map(m => m[1])
}

test('the new UI alignment models are the backend ALIGNMENT_CATALOG, in its order', () => {
  const ids = backendIds()
  assert.ok(ids.length > 0)
  assert.deepEqual(uiIds(), ids)
})
