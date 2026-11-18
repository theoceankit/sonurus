#!/usr/bin/env node
'use strict'

// Fails the build when the app in the dmg is not fully signed. Without a
// certificate electron-builder signs ad hoc (build.mac.identity "-"); if that
// is skipped, only the linker's signature is left and macOS refuses the app
// notifications and ties no permission to it. Checks, in the mounted dmg:
// the bundle (codesign --verify --deep --strict, hardened runtime, Info.plist
// bound, sealed resources, entitlements, usage descriptions) and the two
// processes it starts from Resources, which --deep does not treat as nested
// code: the capture helper and the bundled Python. macOS only:
//   node scripts/check-mac-signature.js [dist]

const fs   = require('fs')
const os   = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const pkg  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const ENTITLEMENTS       = path.join(ROOT, pkg.build.mac.entitlements)
const REQUIRED_INFO_KEYS = Object.keys(pkg.build.mac.extendInfo || {})

const HELPERS = [
  'Contents/Resources/mac/sonorus-capture',
  'Contents/Resources/backend/python-dist/bin/python3',
]

// text: what codesign -dvv prints. bundle: the app itself, whose Info.plist
// and resources must be sealed too.
function signatureProblems(name, text, { bundle = false } = {}) {
  const flags = /flags=0x[0-9a-f]+\(([^)]*)\)/.exec(text)
  if (!flags) {
    const first = text.split('\n').find(l => l.trim()) || 'no output'
    return [`${name}: no signature found (codesign: ${first.trim()})`]
  }
  const list = flags[1].split(',')
  const problems = []
  if (list.includes('linker-signed')) problems.push(`${name}: signed only by the linker`)
  if (!list.includes('runtime')) problems.push(`${name}: no hardened runtime`)
  if (bundle) {
    if (!/^Info\.plist entries=\d+/m.test(text)) problems.push(`${name}: Info.plist is not bound to the signature`)
    if (!/^Sealed Resources version=2\b/m.test(text)) problems.push(`${name}: no Sealed Resources version=2`)
  }
  return problems
}

// plist: build/entitlements.mac.plist. signed: what codesign -d --entitlements -
// prints (XML or the [Dict] form of newer macOS).
function missingEntitlements(plist, signed) {
  const keys = [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map(m => m[1])
  return keys.filter(k => !signed.includes(k))
}

// info: Info.plist as XML.
function missingInfoKeys(info, keys) {
  return keys.filter(k => !info.includes(`<key>${k}</key>`))
}

module.exports = { signatureProblems, missingEntitlements, missingInfoKeys, REQUIRED_INFO_KEYS }

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.error) throw r.error
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

function checkCode(name, file, { bundle = false } = {}) {
  const problems = []
  const verify = run('codesign', bundle
    ? ['--verify', '--deep', '--strict', '--verbose=2', file]
    : ['--verify', '--strict', '--verbose=2', file])
  if (verify.status !== 0) problems.push(`${name}: codesign --verify failed: ${verify.out.trim()}`)
  problems.push(...signatureProblems(name, run('codesign', ['-dvv', file]).out, { bundle }))
  const signed = run('codesign', ['-d', '--entitlements', '-', file]).out
  for (const key of missingEntitlements(fs.readFileSync(ENTITLEMENTS, 'utf8'), signed)) {
    problems.push(`${name}: entitlement ${key} is not in the signature`)
  }
  return problems
}

function checkApp(app) {
  const problems = checkCode('Sonorus.app', app, { bundle: true })
  const info = run('plutil', ['-convert', 'xml1', '-o', '-', path.join(app, 'Contents', 'Info.plist')]).out
  for (const key of missingInfoKeys(info, REQUIRED_INFO_KEYS)) problems.push(`Sonorus.app: Info.plist has no ${key}`)
  for (const rel of HELPERS) {
    const file = path.join(app, rel)
    if (!fs.existsSync(file)) { problems.push(`missing: ${rel}`); continue }
    problems.push(...checkCode(path.basename(rel), fs.realpathSync(file)))
  }
  return problems
}

if (require.main === module) {
  if (process.platform !== 'darwin') {
    console.error('check-mac-signature.js needs macOS (codesign, hdiutil)')
    process.exit(1)
  }
  const dir = process.argv[2] || 'dist'
  const dmgs = fs.readdirSync(dir).filter(f => f.endsWith('.dmg'))
  if (dmgs.length !== 1) {
    console.error(`Expected one .dmg in ${dir}, found ${dmgs.length}`)
    process.exit(1)
  }
  const dmg = path.join(dir, dmgs[0])
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-dmg-'))
  const attach = run('hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmg])
  if (attach.status !== 0) {
    console.error(`hdiutil attach ${dmg} failed: ${attach.out.trim()}`)
    process.exit(1)
  }
  let problems
  try {
    const apps = fs.readdirSync(mount).filter(f => f.endsWith('.app'))
    problems = apps.length === 1 ? checkApp(path.join(mount, apps[0])) : [`expected one .app in ${dmg}, found ${apps.length}`]
  } finally {
    if (run('hdiutil', ['detach', mount]).status !== 0) run('hdiutil', ['detach', '-force', mount])
  }
  console.log(`${dmg}: ${problems.length ? `${problems.length} problem(s)` : 'ok'}`)
  for (const p of problems) console.error(`::error::${p}`)
  process.exit(problems.length ? 1 : 0)
}
