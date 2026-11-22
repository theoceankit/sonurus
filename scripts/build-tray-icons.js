#!/usr/bin/env node
'use strict'

// Builds the Windows and Linux tray icons from the quill of the macOS one
// (build/icons/trayTemplate.svg), which stays the only drawing:
//   electron/assets/trayOnDark.ico   white, for a dark Windows taskbar
//   electron/assets/trayOnLight.ico  black, for a light Windows taskbar
//   electron/assets/trayLinux.png    white with a dark outline, 44 px: Electron hands the
//                                    panel one file, and the panel scales it to its size
// Needs rsvg-convert (librsvg) and magick (ImageMagick).
// Run after changing the SVG: node scripts/build-tray-icons.js

const { execFileSync } = require('child_process')
const fs   = require('fs')
const os   = require('os')
const path = require('path')

const ROOT   = path.resolve(__dirname, '..')
const ASSETS = path.join(ROOT, 'electron', 'assets')
const SOURCE = fs.readFileSync(path.join(ROOT, 'build', 'icons', 'trayTemplate.svg'), 'utf8')

const WINDOWS_SIZES = [16, 20, 24, 32, 40, 48]
const OUTLINE = '#1c1c1c'
// In the units of the path (a tenth of the viewBox): about 1.2 px each side on a 22 px panel.
const OUTLINE_WIDTH = 5200

const white = SOURCE.replace('fill="#000"', 'fill="#fff"')
// The frame is a little wider than the one of the template, so the outline is not cut.
const outlined = SOURCE
  .replace('viewBox="-17 -111 4220 4220"', 'viewBox="-237 -331 4660 4660"')
  .replace(
    'fill="#000"',
    `fill="#fff" stroke="${OUTLINE}" stroke-width="${OUTLINE_WIDTH}" stroke-linejoin="round" paint-order="stroke"`,
  )

const render = (svg, size, file) =>
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', file], { input: svg })

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-tray-icons-'))
try {
  for (const [svg, name] of [[white, 'trayOnDark.ico'], [SOURCE, 'trayOnLight.ico']]) {
    const frames = WINDOWS_SIZES.map(size => {
      const file = path.join(tmp, `${size}.png`)
      render(svg, size, file)
      return file
    })
    execFileSync('magick', [...frames, path.join(ASSETS, name)])
  }
  render(outlined, 44, path.join(ASSETS, 'trayLinux.png'))
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
