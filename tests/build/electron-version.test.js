'use strict'

// Electron 38+ runs as a native Wayland app in a Wayland session. Under
// XWayland (Electron ≤37 default) a file dragged from a Wayland file manager
// reaches the page with an empty dataTransfer, so drop-to-transcribe breaks.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const pkg  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))

const major = version => Number(String(version).replace(/^[^\d]*/, '').split('.')[0])

test('Electron is 38 or later (native Wayland by default)', () => {
  assert.ok(major(pkg.devDependencies.electron) >= 38, `package.json: ${pkg.devDependencies.electron}`)
  const locked = lock.packages['node_modules/electron'].version
  assert.ok(major(locked) >= 38, `package-lock.json: ${locked}`)
})

test('no Wayland / ozone workarounds in the Electron sources', () => {
  for (const name of ['main.js', 'backend.js', 'preload.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'electron', name), 'utf8')
    for (const word of ['ozone-platform', 'ELECTRON_OZONE_PLATFORM_HINT']) {
      assert.ok(!src.includes(word), `${name} mentions ${word}`)
    }
  }
})

test('allowScripts has no stale Electron entry (Electron 42+ has no install script)', () => {
  const keys = Object.keys(pkg.allowScripts || {})
  assert.deepEqual(keys.filter(key => key.startsWith('electron@')), [])
})

test('the main process awaits clipboard writes (async since Electron 44)', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')
  const calls = main.match(/[^\n]*clipboard\.writeText\([^\n]*/g) || []
  assert.ok(calls.length > 0)
  for (const line of calls) assert.match(line, /await clipboard\.writeText\(/)
})
