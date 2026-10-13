#!/usr/bin/env node
'use strict'

// Fails the build when an installer in dist/ exceeds MAX_INSTALLER_MIB.
// GitHub Releases refuses assets over 2 GiB; the margin keeps a release
// publishable. Run after electron-builder:  node scripts/check-installer-size.js [dist]

const fs   = require('fs')
const path = require('path')

const MAX_INSTALLER_MIB = 1900
const INSTALLER_EXT     = ['.dmg', '.exe', '.AppImage']

function oversized(dir, maxMiB = MAX_INSTALLER_MIB) {
  const files = fs.readdirSync(dir)
    .filter(name => INSTALLER_EXT.includes(path.extname(name)))
    .map(name => ({ name, mib: fs.statSync(path.join(dir, name)).size / 1048576 }))
  return { files, tooBig: files.filter(f => f.mib > maxMiB) }
}

module.exports = { MAX_INSTALLER_MIB, oversized }

if (require.main === module) {
  const dir = process.argv[2] || 'dist'
  const { files, tooBig } = oversized(dir)
  if (!files.length) {
    console.error(`No installers found in ${dir}`)
    process.exit(1)
  }
  for (const f of files) console.log(`${f.name}: ${f.mib.toFixed(0)} MiB`)
  for (const f of tooBig) {
    console.error(`::error::${f.name} is ${f.mib.toFixed(0)} MiB, over the ${MAX_INSTALLER_MIB} MiB limit`)
  }
  process.exit(tooBig.length ? 1 : 0)
}
