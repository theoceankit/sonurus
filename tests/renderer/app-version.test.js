const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadRenderer } = require('./load-renderer')

const ELECTRON_DIR = path.join(__dirname, '..', '..', 'electron')
const read = rel => fs.readFileSync(path.join(ELECTRON_DIR, rel), 'utf8')

const { formatAppVersion } = loadRenderer(['utils.js'])

// ── formatAppVersion ───────────────────────────────────────────────────────────

test('formatAppVersion: product name and version', () => {
  assert.equal(formatAppVersion('0.2.0'), 'Sonorus 0.2.0')
})

test('formatAppVersion: product name alone when the version is missing', () => {
  for (const v of [undefined, null, '', '   ', 'unknown']) {
    assert.equal(formatAppVersion(v), 'Sonorus', `for ${JSON.stringify(v)}`)
  }
})

// ── Wiring: package.json → Electron → backend and Settings ─────────────────────

test('main process answers get-app-version from app.getVersion()', () => {
  assert.match(read('main.js'), /ipcMain\.handle\(\s*'get-app-version'\s*,\s*\(\)\s*=>\s*app\.getVersion\(\)\s*\)/)
})

test('preload exposes electronAPI.getAppVersion', () => {
  assert.match(read('preload.js'), /getAppVersion:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('get-app-version'\)/)
})

test('backend is started with SONORUS_VERSION from app.getVersion()', () => {
  assert.match(read('backend.js'), /SONORUS_VERSION:\s*app\.getVersion\(\)/)
})

test('settings view renders the version line with formatAppVersion', () => {
  const src = read('renderer/views/settings-view.js')
  assert.match(src, /st-version/)
  assert.match(src, /getAppVersion\(\)/)
  assert.match(src, /formatAppVersion\(/)
})
