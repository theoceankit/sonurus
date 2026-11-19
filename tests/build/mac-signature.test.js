'use strict'

// macOS builds are signed ad hoc (build.mac.identity "-"): without a certificate
// electron-builder otherwise leaves only the linker's signature, and macOS then
// refuses the app notifications and ties no permission to it. build-mac checks
// the signature in the built dmg with scripts/check-mac-signature.js; its
// parsing of codesign output is tested here on samples, without macOS.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const pkg  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const {
  signatureProblems, missingEntitlements, missingInfoKeys, REQUIRED_INFO_KEYS,
} = require(path.join(ROOT, 'scripts', 'check-mac-signature.js'))

const LINKER_SIGNED = `Executable=/Volumes/Sonorus/Sonorus.app/Contents/MacOS/Sonorus
Identifier=Sonorus
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20400 size=1290 flags=0x20002(adhoc,linker-signed) hashes=37+0 location=embedded
Signature=adhoc
Info.plist=not bound
TeamIdentifier=not set
Sealed Resources=none
Internal requirements=none
`

const AD_HOC_BUNDLE = `Executable=/Volumes/Sonorus/Sonorus.app/Contents/MacOS/Sonorus
Identifier=com.sonorus.app
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20500 size=1471 flags=0x10002(adhoc,runtime) hashes=35+7 location=embedded
Signature=adhoc
Info.plist entries=31
TeamIdentifier=not set
Runtime Version=15.0.0
Sealed Resources version=2 rules=13 files=412
Internal requirements count=0 size=12
`

const AD_HOC_BINARY = `Executable=/Volumes/Sonorus/Sonorus.app/Contents/Resources/mac/sonorus-capture
Identifier=sonorus-capture
Format=Mach-O thin (arm64)
CodeDirectory v=20500 size=2130 flags=0x10002(adhoc,runtime) hashes=56+7 location=embedded
Signature=adhoc
Info.plist=not bound
TeamIdentifier=not set
Runtime Version=15.0.0
Sealed Resources=none
Internal requirements count=0 size=12
`

test('macOS builds are signed ad hoc with the hardened runtime and the entitlements', () => {
  const mac = pkg.build.mac
  assert.equal(mac.identity, '-', 'build.mac.identity must be "-" (ad hoc), or the app keeps only the linker signature')
  assert.equal(mac.hardenedRuntime, true)
  assert.equal(mac.entitlements, 'build/entitlements.mac.plist')
  assert.equal(mac.entitlementsInherit, 'build/entitlements.mac.plist')
})

test('build-mac checks the signature of the dmg after electron-builder and before the upload', () => {
  const build = read('.github/workflows/build.yml')
  const mac = build.slice(build.indexOf('build-mac:'), build.indexOf('build-win:'))
  const check = mac.indexOf('node scripts/check-mac-signature.js dist')
  assert.ok(check > 0, 'build-mac does not run scripts/check-mac-signature.js')
  assert.ok(check > mac.indexOf('electron-builder --mac'), 'the check must run after electron-builder')
  assert.ok(check < mac.indexOf('actions/upload-artifact'), 'the check must run before the upload')
})

test('the Info.plist keys the check requires are the ones build.mac adds', () => {
  assert.deepEqual([...REQUIRED_INFO_KEYS].sort(), Object.keys(pkg.build.mac.extendInfo).sort())
  assert.ok(REQUIRED_INFO_KEYS.includes('NSMicrophoneUsageDescription'))
  assert.ok(REQUIRED_INFO_KEYS.includes('NSAudioCaptureUsageDescription'))
})

test('a linker signature is refused with a reason for each missing part', () => {
  const problems = signatureProblems('Sonorus.app', LINKER_SIGNED, { bundle: true })
  assert.equal(problems.length, 4, problems.join('\n'))
  assert.ok(problems.some(p => /linker/.test(p)))
  assert.ok(problems.some(p => /hardened runtime/.test(p)))
  assert.ok(problems.some(p => /Info\.plist/.test(p)))
  assert.ok(problems.some(p => /Sealed Resources/.test(p)))
  assert.ok(problems.every(p => p.startsWith('Sonorus.app: ')))
})

test('a full ad hoc signature of the bundle passes', () => {
  assert.deepEqual(signatureProblems('Sonorus.app', AD_HOC_BUNDLE, { bundle: true }), [])
})

test('a helper binary needs the hardened runtime but no Info.plist or sealed resources', () => {
  assert.deepEqual(signatureProblems('sonorus-capture', AD_HOC_BINARY), [])
  const noRuntime = AD_HOC_BINARY.replace('flags=0x10002(adhoc,runtime)', 'flags=0x2(adhoc)')
  const problems = signatureProblems('sonorus-capture', noRuntime)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /hardened runtime/)
})

test('output that cannot be read is a problem, not a pass', () => {
  assert.equal(signatureProblems('python3', '').length, 1)
  assert.equal(signatureProblems('python3', 'python3: code object is not signed at all\n').length, 1)
  assert.ok(signatureProblems('Sonorus.app', 'Signature=adhoc\n', { bundle: true }).length >= 1)
})

test('every entitlement of build/entitlements.mac.plist must be in the signature', () => {
  const plist = read('build/entitlements.mac.plist')
  const keys = [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map(m => m[1])
  assert.ok(keys.includes('com.apple.security.device.audio-input'))

  // codesign -d --entitlements - prints XML on older macOS and this form on newer ones
  const signed = '[Dict]\n' + keys.map(k => `\t[Key] ${k}\n\t[Value]\n\t\t[Bool] true\n`).join('')
  assert.deepEqual(missingEntitlements(plist, signed), [])
  assert.deepEqual(missingEntitlements(plist, plist), [])

  const without = signed.replace('com.apple.security.device.audio-input', 'x')
  assert.deepEqual(missingEntitlements(plist, without), ['com.apple.security.device.audio-input'])
  assert.deepEqual(missingEntitlements(plist, ''), keys)
})

test('the usage descriptions must be in the built Info.plist', () => {
  const info = '<dict>\n<key>NSMicrophoneUsageDescription</key>\n<string>…</string>\n</dict>'
  assert.deepEqual(missingInfoKeys(info, REQUIRED_INFO_KEYS), ['NSAudioCaptureUsageDescription'])
  const full = info.replace('</dict>', '<key>NSAudioCaptureUsageDescription</key>\n<string>…</string>\n</dict>')
  assert.deepEqual(missingInfoKeys(full, REQUIRED_INFO_KEYS), [])
})
