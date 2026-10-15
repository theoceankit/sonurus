// Dev mode and the packaged app never see each other's data: dev keeps its
// own data dir, and a backend already answering on :8000 is reused only if it
// is ours (electron/backend-identity.js).
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { devUserDataPath, reuseDecision, servesDataDir } = require(path.join(ROOT, 'electron', 'backend-identity.js'))

const APP_DATA = path.join(path.sep, 'home', 'u', '.config')
const MINE = path.join(APP_DATA, 'sonorus')
const OTHER = path.join(APP_DATA, 'sonorus-dev')

// ── data dir ──────────────────────────────────────────────────────────────────

test('dev mode keeps its data in sonorus-dev', () => {
  assert.equal(devUserDataPath({ isPackaged: false, hasUserDataSwitch: false, appData: APP_DATA }),
    path.join(APP_DATA, 'sonorus-dev'))
})

test('the packaged app keeps the default data dir', () => {
  assert.equal(devUserDataPath({ isPackaged: true, hasUserDataSwitch: false, appData: APP_DATA }), null)
})

test('--user-data-dir wins in dev mode', () => {
  assert.equal(devUserDataPath({ isPackaged: false, hasUserDataSwitch: true, appData: APP_DATA }), null)
})

// ── same data dir ─────────────────────────────────────────────────────────────

test('a data dir matches itself, also with a trailing separator', () => {
  assert.equal(servesDataDir({ status: 'ok', data_dir: MINE + path.sep }, MINE, 'linux'), true)
  assert.equal(servesDataDir({ status: 'ok', data_dir: OTHER }, MINE, 'linux'), false)
})

test('case is ignored on macOS and Windows only', () => {
  const upper = { status: 'ok', data_dir: MINE.toUpperCase() }
  assert.equal(servesDataDir(upper, MINE, 'darwin'), true)
  assert.equal(servesDataDir(upper, MINE, 'win32'), true)
  assert.equal(servesDataDir(upper, MINE, 'linux'), false)
})

test('a backend that does not report its data dir is not ours', () => {
  assert.equal(servesDataDir({ status: 'ok' }, MINE, 'linux'), false)
  assert.equal(servesDataDir(null, MINE, 'linux'), false)
})

// ── reuse a running backend? ──────────────────────────────────────────────────

const packaged = { packaged: true, dataDir: MINE, platform: 'linux' }
const dev = { packaged: false, dataDir: OTHER, platform: 'linux' }

test('nothing on the port → start our own backend', () => {
  assert.equal(reuseDecision(null, packaged).action, 'spawn')
  assert.equal(reuseDecision(null, dev).action, 'spawn')
})

test('packaged app reuses its own backend (e.g. left running after a crash)', () => {
  assert.equal(reuseDecision({ status: 'ok', data_dir: MINE, packaged: true }, packaged).action, 'reuse')
})

test('packaged app refuses a dev backend and names its data dir', () => {
  const d = reuseDecision({ status: 'ok', data_dir: OTHER, packaged: false }, packaged)
  assert.equal(d.action, 'refuse')
  assert.match(d.message, /port 8000/i)
  assert.ok(d.message.includes(OTHER))
})

test('packaged app refuses another packaged app with another data dir', () => {
  const d = reuseDecision({ status: 'ok', data_dir: OTHER, packaged: true }, packaged)
  assert.equal(d.action, 'refuse')
  assert.ok(d.message.includes(OTHER))
})

test('packaged app refuses an older backend or another program', () => {
  for (const health of [{ status: 'ok' }, {}]) {
    const d = reuseDecision(health, packaged)
    assert.equal(d.action, 'refuse')
    assert.match(d.message, /port 8000/i)
  }
})

test('dev mode reuses a backend started by hand (uvicorn)', () => {
  assert.equal(reuseDecision({ status: 'ok', data_dir: '/home/u/sonurus', packaged: false }, dev).action, 'reuse')
  assert.equal(reuseDecision({ status: 'ok' }, dev).action, 'reuse')
})

test('dev mode refuses the packaged app’s backend', () => {
  const d = reuseDecision({ status: 'ok', data_dir: MINE, packaged: true }, dev)
  assert.equal(d.action, 'refuse')
  assert.ok(d.message.includes(MINE))
})

test('dev mode refuses a program that is not Sonorus', () => {
  assert.equal(reuseDecision({}, dev).action, 'refuse')
})
