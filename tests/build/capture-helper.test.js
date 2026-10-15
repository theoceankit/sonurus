'use strict'

// Windows captures system audio with the bundled WASAPI loopback helper
// (native/windows/sonorus-capture). It is built before packaging, shipped as
// resources/win/sonorus-capture.exe and handed to the backend like the macOS
// helper. CI cannot run it, so the Linux test job at least compiles it.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const pkg  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const { compileCommand, upToDate } = require(path.join(ROOT, 'scripts', 'build-capture-win.js'))

test('the helper source is in the repository', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'native', 'windows', 'sonorus-capture', 'main.cpp')))
})

test('the Windows build ships the helper as resources/win/sonorus-capture.exe', () => {
  const entry = pkg.build.extraResources.find(r => r.to === 'win/')
  assert.ok(entry, 'no extraResources entry for win/')
  assert.equal(path.normalize(entry.from), path.normalize('electron/resources/win/'))
  assert.deepEqual(entry.filter, ['sonorus-capture.exe'])
})

test('npm run build:win builds the helper first', () => {
  assert.ok(pkg.scripts['build:capture:win'].includes('scripts/build-capture-win.js'))
  assert.ok(pkg.scripts['build:win'].startsWith('npm run build:capture:win && '))
})

test('CI builds the helper before packaging Windows and compiles it in the test job', () => {
  const build = read('.github/workflows/build.yml')
  const win = build.slice(build.indexOf('build-win:'))
  const helper = win.indexOf('npm run build:capture:win')
  assert.ok(helper > 0, 'build-win does not build the helper')
  assert.ok(helper < win.indexOf('electron-builder --win'), 'helper must be built before electron-builder')

  const tests = read('.github/workflows/tests.yml')
  assert.ok(tests.includes('mingw-w64'), 'tests.yml does not install mingw-w64')
  assert.ok(tests.includes('build:capture:win'), 'tests.yml does not compile the helper')
})

test('MSVC build links the C runtime statically (no VC++ runtime needed)', () => {
  const { cmd, args } = compileCommand('msvc', 'main.cpp', 'out.exe', 'obj')
  assert.equal(cmd, 'cl')
  assert.ok(args.includes('/MT'))
  assert.ok(args.includes('/O2'))
  assert.ok(args.includes('ole32.lib'))
})

test('mingw cross build is static and Unicode (wmain)', () => {
  const { cmd, args } = compileCommand('mingw', 'main.cpp', 'out.exe')
  assert.equal(cmd, 'x86_64-w64-mingw32-g++')
  for (const flag of ['-static', '-municode', '-O2', '-lole32']) assert.ok(args.includes(flag), flag)
  assert.equal(args[args.indexOf('-o') + 1], 'out.exe')
})

test('the backend gets the helper path on Windows too', () => {
  const src = read('electron/backend.js')
  assert.ok(src.includes("'win', 'sonorus-capture.exe'"), 'backend.js does not point at win/sonorus-capture.exe')
})

test('the built helper is not committed', () => {
  assert.ok(read('.gitignore').split('\n').includes('electron/resources/win/sonorus-capture.exe'))
})

test('without a compiler, an existing helper is kept only if it is not older than its source', t => {
  const os = require('os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-helper-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const src = path.join(dir, 'main.cpp'), out = path.join(dir, 'sonorus-capture.exe')
  fs.writeFileSync(src, '')
  assert.equal(upToDate(out, src), false, 'no helper yet')
  fs.writeFileSync(out, '')
  fs.utimesSync(src, new Date(1000), new Date(1000))
  assert.equal(upToDate(out, src), true, 'copied in after the source')
  fs.utimesSync(out, new Date(500), new Date(500))
  assert.equal(upToDate(out, src), false, 'stale helper')
})
