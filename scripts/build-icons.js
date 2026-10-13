#!/usr/bin/env node
'use strict'

// Builds the installer icons from the two app icon masters (1024×1024 PNG,
// exported from the design file, page "Logo"):
//   electron/assets/icon-macos.png → build/icons/icon.icns
//   electron/assets/icon.png       → build/icons/icon.ico
// Linux uses electron/assets/icon.png directly; electron-builder makes the size set.
// Run after replacing a master: node scripts/build-icons.js

const fs        = require('fs')
const path      = require('path')
const png2icons = require('png2icons')

const ROOT = path.resolve(__dirname, '..')

const ICONS = [
  { from: 'electron/assets/icon-macos.png', to: 'build/icons/icon.icns', make: buf => png2icons.createICNS(buf, png2icons.BICUBIC, 0) },
  { from: 'electron/assets/icon.png',       to: 'build/icons/icon.ico',  make: buf => png2icons.createICO(buf, png2icons.BICUBIC, 0, true) },
]

for (const { from, to, make } of ICONS) {
  const out = make(fs.readFileSync(path.join(ROOT, from)))
  if (!out) throw new Error(`png2icons could not convert ${from}`)
  fs.writeFileSync(path.join(ROOT, to), out)
  console.log(`${from} → ${to} (${Math.round(out.length / 1024)} KiB)`)
}
