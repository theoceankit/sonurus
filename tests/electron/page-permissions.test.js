'use strict'

// The backend records the microphone and system audio; the page asks for no
// device. Without a handler Electron grants every permission request, so the
// handler stays and refuses them all.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const main = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.js'), 'utf8')

test('the page gets no permission, the microphone included', () => {
  const at = main.indexOf('setPermissionRequestHandler(')
  assert.ok(at > 0, 'the permission handler is gone: Electron would grant every request')
  const handler = main.slice(at, main.indexOf('})', at))
  assert.match(handler, /callback\(false\)/)
  assert.doesNotMatch(handler, /'media'/)
})
