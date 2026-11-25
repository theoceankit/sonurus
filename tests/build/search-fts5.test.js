'use strict'

// Recording search keeps an SQLite FTS5 index (app/db/search_index.py) that the
// database migration creates at startup: a bundled Python whose SQLite lacks
// FTS5 would not start. The import check proves it on each built interpreter.

const test   = require('node:test')
const assert = require('node:assert/strict')
const path   = require('path')
const { spawnSync } = require('child_process')

const ROOT    = path.resolve(__dirname, '..', '..')
const imports = require(path.join(ROOT, 'scripts', 'check-bundled-imports.js'))

test('the import check creates an FTS5 table as the search index does', () => {
  const src = imports.checkSource()
  assert.match(src, /USING fts5\(text, tokenize='unicode61'\)/)
})

test('the import check imports the search route and service', () => {
  assert.ok(imports.BUNDLED_IMPORTS.includes('app.api.routers.search'))
  assert.ok(imports.BUNDLED_IMPORTS.includes('app.services.search_service'))
})

test('the FTS5 lines of the check run on this Python', { skip: !process.env.PYTHON && 'set PYTHON to a Python 3 to run' }, () => {
  const src = imports.checkSource()
  const fts = src.split('\n').filter(line => line.includes('sqlite3')).join('\n')
  const run = spawnSync(process.env.PYTHON, ['-c', fts], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
})
