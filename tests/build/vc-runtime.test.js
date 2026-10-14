'use strict'

// On Windows the bundled libraries (torch's c10.dll among them) link against
// the Microsoft Visual C++ 2015–2022 runtime. python-build-standalone carries
// only vcruntime140*.dll, and a clean Windows has no msvcp140.dll, so the
// Windows build copies the runtime from the build machine into python-dist,
// next to python.exe (app-local deployment, no vc_redist on the user's machine).

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const os     = require('os')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { VC_RUNTIME_DLLS, copyVcRuntime } = require(path.join(ROOT, 'scripts', 'bundle-backend.js'))

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-vcrt-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('the runtime list covers the C++ library and the C runtime', () => {
  for (const name of ['msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll',
                      'vcruntime140.dll', 'vcruntime140_1.dll', 'concrt140.dll', 'vcomp140.dll']) {
    assert.ok(VC_RUNTIME_DLLS.includes(name), `missing ${name}`)
  }
})

test('copyVcRuntime copies every runtime DLL next to python.exe, replacing older ones', t => {
  const system = tempDir(t)
  const pyDist = tempDir(t)
  for (const name of VC_RUNTIME_DLLS) fs.writeFileSync(path.join(system, name), `system ${name}`)
  fs.writeFileSync(path.join(pyDist, 'vcruntime140.dll'), 'bundled with Python')

  copyVcRuntime(pyDist, system)

  for (const name of VC_RUNTIME_DLLS) {
    assert.equal(fs.readFileSync(path.join(pyDist, name), 'utf8'), `system ${name}`, name)
  }
})

test('copyVcRuntime fails with the missing DLLs named when the build machine has no runtime', t => {
  const system = tempDir(t)
  const pyDist = tempDir(t)
  fs.writeFileSync(path.join(system, 'vcruntime140.dll'), 'x')

  assert.throws(() => copyVcRuntime(pyDist, system), err => {
    assert.match(err.message, /msvcp140\.dll/)
    assert.match(err.message, /Visual C\+\+ Redistributable/)
    return true
  })
  assert.ok(!fs.existsSync(path.join(pyDist, 'vcruntime140.dll')), 'nothing is copied when a DLL is missing')
})

test('the Windows build copies the runtime from System32', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'bundle-backend.js'), 'utf8')
  const main = src.slice(src.indexOf('async function main()'))
  assert.match(main, /if \(process\.platform === 'win32'\) \{[^}]*copyVcRuntime\(PY_DIST, [^\n]*System32/)
})
