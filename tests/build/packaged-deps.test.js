'use strict'

// Packaged builds ship every Python library inside the installer, installed at
// build time from per-platform lock files (scripts/lock-backend.js). These
// tests guard the lock files and the absence of the old first-run pip setup.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { BUILD_TARGETS, lockPath } = require(path.join(ROOT, 'scripts', 'bundle-backend.js'))

const PYTORCH_CPU_INDEX = 'https://download.pytorch.org/whl/cpu'

const normName = name => name.toLowerCase().replace(/[_.]+/g, '-')

// { name → { version, hashes } } from a uv/pip-compile lock file
function parseLock(text) {
  const pkgs = {}
  let current = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const pin = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?==([^\s\\;]+)/)
    if (pin) {
      current = { version: pin[2], hashes: [] }
      pkgs[normName(pin[1])] = current
    }
    const hash = line.match(/--hash=sha256:[0-9a-f]{64}/)
    if (hash && current) current.hashes.push(hash[0])
    if (!line.endsWith('\\')) current = null
  }
  return pkgs
}

// direct dependencies: { name → version } from requirements.packaged.txt
function directDeps() {
  const text = fs.readFileSync(path.join(ROOT, 'requirements.packaged.txt'), 'utf8')
  const deps = {}
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim()
    const pin = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?==(\S+)$/)
    if (pin) deps[normName(pin[1])] = pin[2]
  }
  return deps
}

const readLock = key => fs.readFileSync(lockPath(key), 'utf8')

test('every CI build target has a lock file', () => {
  assert.deepEqual([...BUILD_TARGETS].sort(), ['darwin-arm64', 'linux-x64', 'win32-x64'])
  for (const key of BUILD_TARGETS) {
    assert.ok(fs.existsSync(lockPath(key)), `missing ${path.relative(ROOT, lockPath(key))}`)
  }
})

for (const key of BUILD_TARGETS) {
  test(`${key} lock pins every package with a hash`, () => {
    const pkgs = parseLock(readLock(key))
    assert.ok(Object.keys(pkgs).length > 50, 'lock looks empty')
    for (const [name, { hashes }] of Object.entries(pkgs)) {
      assert.ok(hashes.length > 0, `${name} has no --hash`)
    }
  })

  test(`${key} lock matches the direct dependencies of requirements.packaged.txt`, () => {
    const pkgs = parseLock(readLock(key))
    for (const [name, version] of Object.entries(directDeps())) {
      // macOS wheels are CPU-only without the +cpu local version
      const expected = key.startsWith('darwin') ? version.replace(/\+cpu$/, '') : version
      assert.ok(pkgs[name], `${name} missing from ${key} lock`)
      assert.equal(pkgs[name].version, expected, `${name} version in ${key} lock`)
    }
  })

  test(`${key} lock has no CUDA packages`, () => {
    const pkgs = parseLock(readLock(key))
    const cuda = Object.keys(pkgs).filter(n => n.startsWith('nvidia-'))
    assert.deepEqual(cuda, [])
    for (const name of ['torch', 'torchaudio']) {
      const v = pkgs[name].version
      assert.ok(!/\+cu\d+/.test(v), `${name} ${v} is a CUDA build`)
      if (!key.startsWith('darwin')) assert.match(v, /\+cpu$/, `${name} must be the +cpu build`)
    }
  })

  if (!key.startsWith('darwin')) {
    test(`${key} lock names the PyTorch CPU index`, () => {
      assert.ok(readLock(key).includes(`--extra-index-url ${PYTORCH_CPU_INDEX}`))
    })
  }
}

test('packaged backend start installs nothing', () => {
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'backend.js'), 'utf8')
  assert.ok(!/['"]pip['"]/.test(src), 'backend.js must not run pip')
  assert.ok(!src.includes('python-packages'), 'backend.js must not use userData/python-packages')
})

test('first-run setup screen is gone', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'electron', 'renderer', 'setup.html')))
  assert.ok(!fs.existsSync(path.join(ROOT, 'electron', 'screenshot-setup.js')))
  const main    = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')
  const preload = fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8')
  assert.ok(!main.includes('setup.html'))
  for (const name of ['setup-progress', 'start-setup', 'setup-complete', 'needsSetup']) {
    assert.ok(!main.includes(name), `main.js still uses ${name}`)
  }
  for (const name of ['onSetupProgress', 'startSetup', 'completeSetup']) {
    assert.ok(!preload.includes(name), `preload.js still exposes ${name}`)
  }
})

test('installer size check flags only files over the limit', () => {
  const os = require('os')
  const { MAX_INSTALLER_MIB, oversized } = require(path.join(ROOT, 'scripts', 'check-installer-size.js'))
  assert.equal(MAX_INSTALLER_MIB, 1900)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-size-'))
  try {
    fs.writeFileSync(path.join(dir, 'small.AppImage'), Buffer.alloc(2 * 1048576))
    fs.writeFileSync(path.join(dir, 'big.exe'), Buffer.alloc(3 * 1048576))
    fs.writeFileSync(path.join(dir, 'notes.yml'), Buffer.alloc(5 * 1048576))
    const { files, tooBig } = oversized(dir, 2.5)
    assert.deepEqual(files.map(f => f.name).sort(), ['big.exe', 'small.AppImage'])
    assert.deepEqual(tooBig.map(f => f.name), ['big.exe'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installers leave out the cached Python tarball', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const backend = pkg.build.extraResources.find(r => r.from === 'backend-dist/')
  assert.ok(backend.filter.includes('!*.tar.gz'))
})
