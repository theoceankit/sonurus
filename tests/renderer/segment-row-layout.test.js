const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Changing a segment's speaker rebuilds the editor; the rows must not move.
// So nothing in a row's layout may depend on who speaks.

const RENDERER_DIR = path.join(__dirname, '..', '..', 'electron', 'renderer')

function sources(ext) {
  const out = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (ext.test(entry.name)) out.push(p)
    }
  }
  walk(RENDERER_DIR)
  return out
}

function cssRule(selector) {
  const css = sources(/\.css$/).map(f => fs.readFileSync(f, 'utf8')).join('\n')
  const esc = selector.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
  const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`))
  return m && m[1]
}

test('no extra gap between speakers: rows are not marked where the speaker changes', () => {
  const found = sources(/\.(js|html|css)$/)
    .filter(f => fs.readFileSync(f, 'utf8').includes('seg-row--speaker-break'))
    .map(f => path.relative(RENDERER_DIR, f))
  assert.deepEqual(found, [])
})

test('speaker name in a segment row is one line of fixed height', () => {
  const rule = cssRule('.seg-speaker-name')
  assert.ok(rule, '.seg-speaker-name rule not found')
  assert.match(rule, /white-space:\s*nowrap/, 'a long name must not wrap to a second line')
  assert.match(rule, /overflow-x:\s*(clip|hidden)/)
  assert.match(rule, /text-overflow:\s*ellipsis/)
  // Scripts drawn from fallback fonts (CJK, Thai, …) would otherwise make the line taller
  assert.match(rule, /line-height:\s*\d+(\.\d+)?px/)
})
