const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadRenderer } = require('./load-renderer')

const RENDERER_DIR = path.join(__dirname, '..', '..', 'electron', 'renderer')
const ICONS_DIR = path.join(__dirname, '..', '..', 'electron', 'assets', 'icons')

const { icon, iconUrl, hydrateIcons } = loadRenderer(['icons.js'])

function rendererSources() {
  const out = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.(js|html)$/.test(entry.name)) out.push(p)
    }
  }
  walk(RENDERER_DIR)
  return out
}

const iconFiles = fs.readdirSync(ICONS_DIR).filter(f => f.endsWith('.svg'))

test('icon: resolves the file in electron/assets/icons relative to the renderer', () => {
  assert.equal(iconUrl('play'), '../assets/icons/play.svg')
  const resolved = path.resolve(RENDERER_DIR, iconUrl('play'))
  assert.equal(resolved, path.join(ICONS_DIR, 'play.svg'))
})

test('icon: square box of the given size, masked with the file, filled with currentColor', () => {
  const html = icon('play', 12, 'extra')
  assert.match(html, /^<span class="icon extra" data-icon="play"/)
  assert.match(html, /width:12px;height:12px/)
  assert.match(html, /mask:url\('\.\.\/assets\/icons\/play\.svg'\)/)
  assert.match(html, /background-color:currentColor/)
})

test('hydrateIcons: fills static placeholders and keeps their own inline style', () => {
  const el = {
    dataset: { icon: 'check', size: '11' },
    style: { cssText: 'color: #fff;' },
    classList: { add(c) { this.added = c } },
    setAttribute() {},
  }
  hydrateIcons({ querySelectorAll: () => [el] })
  assert.equal(el.classList.added, 'icon')
  assert.match(el.style.cssText, /check\.svg/)
  assert.match(el.style.cssText, /width:11px/)
  assert.match(el.style.cssText, /color: #fff;$/)
})

test('every icon used in the renderer has a file', () => {
  const missing = []
  for (const file of rendererSources().filter(f => path.basename(f) !== 'icons.js')) {
    const src = fs.readFileSync(file, 'utf8')
    const names = [
      ...src.matchAll(/\bicon\('([^']+)'/g),
      ...src.matchAll(/data-icon="([^"$]+)"/g),
    ].map(m => m[1])
    for (const name of names) {
      if (!iconFiles.includes(`${name}.svg`)) missing.push(`${path.relative(RENDERER_DIR, file)}: ${name}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('icon files: kebab-case names, standalone SVG with a viewBox', () => {
  for (const file of iconFiles) {
    assert.match(file, /^[a-z0-9]+(-[a-z0-9]+)*\.svg$/, file)
    const svg = fs.readFileSync(path.join(ICONS_DIR, file), 'utf8')
    const root = svg.match(/<svg\b[^>]*>/)
    assert.ok(root, `${file}: no <svg> element`)
    assert.match(root[0], /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${file}: xmlns is required to load it as an image`)
    assert.match(root[0], /viewBox="[^"]+"/, `${file}: viewBox is required to scale it`)
  }
})

test('no inline SVG icons left in the renderer', () => {
  // The dashed drop-zone border is a stretched shape, not an icon.
  const allowed = /<svg class="nr-drop-border"/
  const found = []
  for (const file of rendererSources()) {
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(/<svg\b[^>]*>/g)) {
      if (!allowed.test(m[0])) found.push(path.relative(RENDERER_DIR, file))
    }
  }
  assert.deepEqual(found, [])
})

test('renderer scripts parse after icon substitutions', () => {
  const vm = require('node:vm')
  for (const file of rendererSources().filter(f => f.endsWith('.js'))) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }), file)
  }
})
