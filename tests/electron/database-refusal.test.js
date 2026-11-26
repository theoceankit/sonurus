// A backend that refuses its database says so in stderr; the start-up dialog
// says why in words (electron/database-refusal.js).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { MARKER, databaseRefusal } = require(path.join(ROOT, 'electron', 'database-refusal.js'))

const DIR = path.join(path.sep, 'home', 'u', '.config', 'sonorus')
const LOG = 'INFO  [api] starting\nERROR [api] Database refused: schema version 9\n'

test('a database of a newer version asks for that version', () => {
  const message = databaseRefusal(`${LOG}${MARKER} newer\nTraceback (most recent call last):\n`, DIR)
  assert.match(message, /newer version of Sonorus/)
  assert.match(message, /has not been changed/)
  assert.ok(message.endsWith(`Data folder: ${DIR}`))
})

test('a database too old says which versions it can open', () => {
  const message = databaseRefusal(`${LOG}${MARKER} unsupported\n`, DIR)
  assert.match(message, /older than 0\.2\.0/)
  assert.match(message, /has not been changed/)
})

test('the line may end the Windows way', () => {
  assert.match(databaseRefusal(`${MARKER} newer\r\n`, DIR), /newer version/)
})

test('a kind it does not know still explains', () => {
  assert.match(databaseRefusal(`${MARKER} damaged\n`, DIR), /cannot open/)
})

test('any other start-up failure is no refusal', () => {
  assert.equal(databaseRefusal('Traceback (most recent call last):\nOSError: [Errno 98] Address in use\n', DIR), null)
  assert.equal(databaseRefusal(`a log line quoting ${MARKER} newer in passing\n`, DIR), null)
})

test('the backend writes the same marker', () => {
  const main = fs.readFileSync(path.join(ROOT, 'app', 'api', 'main.py'), 'utf8')
  assert.match(main, new RegExp(`"${MARKER}"`))
})

test('the dialog texts follow the UI text rules', () => {
  for (const kind of ['newer', 'unsupported']) {
    const message = databaseRefusal(`${MARKER} ${kind}\n`, DIR)
    assert.doesNotMatch(message, /[·…“”‘’]/)
  }
})

test('the backend start turns a refusal into the refusal dialog, also with the GPU pack', () => {
  const backend = fs.readFileSync(path.join(ROOT, 'electron', 'backend.js'), 'utf8')
  assert.match(backend, /databaseRefusal\(stderr\.text, dataDir\)/)
  assert.match(backend, /err instanceof BackendRefusedError \|\| !gpu\?\.usePack/)
})
