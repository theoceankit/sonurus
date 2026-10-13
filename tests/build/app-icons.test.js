'use strict'

// App icons: two masters drawn in the design file (page "Logo") and the
// installer icons built from them by scripts/build-icons.js.
//   electron/assets/icon-macos.png — macOS: plate 824 on a 1024 canvas, margin 100
//   electron/assets/icon.png       — Windows, Linux: plate 896, margin 64, 8 px up
// The tests read PNG, ICNS and ICO with Node built-ins only (CI has no node_modules).

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')
const zlib   = require('zlib')

const ROOT = path.resolve(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel))
const pkg  = JSON.parse(read('package.json'))

const MAC_MASTER = 'electron/assets/icon-macos.png'
const WIN_MASTER = 'electron/assets/icon.png'
const ICNS       = 'build/icons/icon.icns'
const ICO        = 'build/icons/icon.ico'

// 8-bit RGBA PNG → { width, height, rgba }
function decodePng(buf) {
  assert.equal(buf.toString('latin1', 1, 4), 'PNG', 'not a PNG')
  let pos = 8, width, height, depth, colorType, interlace
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      depth = data[8]; colorType = data[9]; interlace = data[12]
    }
    if (type === 'IDAT') idat.push(data)
    if (type === 'IEND') break
    pos += 12 + len
  }
  assert.ok(depth === 8 && colorType === 6 && interlace === 0, 'expected 8-bit RGBA, not interlaced')
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * 4, rgba = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? rgba[y * stride + x - 4] : 0
      const b = y > 0 ? rgba[(y - 1) * stride + x] : 0
      const c = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      rgba[y * stride + x] = v & 0xff
    }
  }
  return { width, height, rgba }
}

// bounding box of pixels with alpha above half
function opaqueBox({ width, height, rgba }) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (rgba[(y * width + x) * 4 + 3] > 127) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

// ICNS → { type → data }
function icnsEntries(buf) {
  assert.equal(buf.toString('latin1', 0, 4), 'icns')
  const out = {}
  for (let pos = 8; pos < buf.length;) {
    const type = buf.toString('latin1', pos, pos + 4), len = buf.readUInt32BE(pos + 4)
    out[type] = buf.subarray(pos + 8, pos + len)
    pos += len
  }
  return out
}

// ICO → [{ size, data }]
function icoEntries(buf) {
  assert.equal(buf.readUInt16LE(2), 1, 'not an ICO')
  const out = []
  for (let i = 0; i < buf.readUInt16LE(4); i++) {
    const e = 6 + i * 16
    const size = buf[e] || 256, len = buf.readUInt32LE(e + 8), off = buf.readUInt32LE(e + 12)
    out.push({ size, data: buf.subarray(off, off + len) })
  }
  return out
}

const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) <= 1, `${msg}: ${actual}, expected ${expected} ±1`)

test('package.json points every platform at its icon', () => {
  assert.equal(pkg.build.mac.icon, ICNS)
  assert.equal(pkg.build.win.icon, ICO)
  assert.equal(pkg.build.linux.icon, WIN_MASTER)
})

test('macOS master: 1024 canvas, plate 824 with margin 100', () => {
  const img = decodePng(read(MAC_MASTER))
  assert.deepEqual([img.width, img.height], [1024, 1024])
  assert.deepEqual(opaqueBox(img), { x: 100, y: 100, w: 824, h: 824 })
})

test('Windows, Linux master: 1024 canvas, plate 896 with margin 64, 8 px up', () => {
  const img = decodePng(read(WIN_MASTER))
  assert.deepEqual([img.width, img.height], [1024, 1024])
  assert.deepEqual(opaqueBox(img), { x: 64, y: 56, w: 896, h: 896 })
})

test('icon.icns is built from the macOS master', () => {
  const entries = icnsEntries(read(ICNS))
  assert.ok(entries.ic10, 'no 1024 px (ic10) image')
  const master = decodePng(read(MAC_MASTER)), big = decodePng(entries.ic10)
  assert.deepEqual([big.width, big.height], [1024, 1024])
  assert.ok(big.rgba.equals(master.rgba), 'ic10 differs from the macOS master: run node scripts/build-icons.js')
  for (const type of ['ic07', 'ic08', 'ic09']) assert.ok(entries[type], `no ${type} image`)
})

test('icon.ico is built from the Windows, Linux master', () => {
  const entries = icoEntries(read(ICO))
  const sizes = entries.map(e => e.size)
  for (const s of [16, 24, 32, 48, 256]) assert.ok(sizes.includes(s), `no ${s} px image (has ${sizes})`)
  const img = decodePng(entries.find(e => e.size === 256).data)
  const box = opaqueBox(img)
  near(box.x, 16, 'plate x'); near(box.y, 14, 'plate y'); near(box.w, 224, 'plate width'); near(box.h, 224, 'plate height')
})
