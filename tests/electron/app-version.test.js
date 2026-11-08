const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ELECTRON_DIR = path.join(__dirname, '..', '..', 'electron')
const read = rel => fs.readFileSync(path.join(ELECTRON_DIR, rel), 'utf8')

// The version comes from package.json through Electron: to the backend, and to
// Settings over preload (the line itself: ui/src/screens/Settings/sections.test.ts).

test('main process answers get-app-version from app.getVersion()', () => {
  assert.match(read('main.js'), /ipcMain\.handle\(\s*'get-app-version'\s*,\s*\(\)\s*=>\s*app\.getVersion\(\)\s*\)/)
})

test('preload exposes electronAPI.getAppVersion', () => {
  assert.match(read('preload.js'), /getAppVersion:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('get-app-version'\)/)
})

test('backend is started with SONORUS_VERSION from app.getVersion()', () => {
  assert.match(read('backend.js'), /SONORUS_VERSION:\s*app\.getVersion\(\)/)
})
