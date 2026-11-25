#!/usr/bin/env node
'use strict'

// Builds the installer icons from the two app icon masters (1024×1024 PNG,
// exported from the design file, page "Logo"):
//   electron/assets/icon-macos.png → build/icons/icon.icns
//   electron/assets/icon.png       → build/icons/icon.ico
//   electron/assets/icon.png       → build/icons/linux/NxN.png, the hicolor sizes
// electron-builder copies a single Linux PNG as is, so a 1024 px master would land in
// hicolor/1024x1024, which the icon theme does not have; from a directory of NxN.png it
// installs each file into its own size.
// Run after replacing a master: node scripts/build-icons.js

const fs        = require('fs')
const path      = require('path')
const png2icons = require('png2icons')
// The scaler and encoder png2icons uses for the ICO frames (BICUBIC), so every platform
// gets the same pixels. Always 8-bit RGBA: small sizes would otherwise become palette PNGs.
const Resize    = require('png2icons/lib/resize3')
const UPNG      = require('png2icons/lib/UPNG')

const ROOT = path.resolve(__dirname, '..')

const LINUX_MASTER = 'electron/assets/icon.png'
const LINUX_DIR    = 'build/icons/linux'
const LINUX_SIZES  = [16, 24, 32, 48, 64, 128, 256, 512]

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

const decoded = UPNG.decode(fs.readFileSync(path.join(ROOT, LINUX_MASTER)))
const master  = { width: decoded.width, height: decoded.height, data: new Uint8Array(UPNG.toRGBA8(decoded)[0]) }
fs.rmSync(path.join(ROOT, LINUX_DIR), { recursive: true, force: true })
fs.mkdirSync(path.join(ROOT, LINUX_DIR), { recursive: true })
for (const size of LINUX_SIZES) {
  const scaled = { width: size, height: size, data: new Uint8Array(size * size * 4) }
  Resize.bicubicInterpolation(master, scaled)
  const to = `${LINUX_DIR}/${size}x${size}.png`
  fs.writeFileSync(path.join(ROOT, to), Buffer.from(UPNG.encode([scaled.data.buffer], size, size, 0, [], {}, true)))
}
console.log(`${LINUX_MASTER} → ${LINUX_DIR}/ (${LINUX_SIZES.join(', ')} px)`)
