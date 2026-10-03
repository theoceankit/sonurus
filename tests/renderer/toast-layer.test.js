// Toasts sit above every other layer: shown while a modal is open, they must
// not end up under its blurred backdrop (and must stay clickable).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const STYLES = path.join(__dirname, '..', '..', 'electron', 'renderer', 'styles')

test('#toast-stack has the highest z-index of all renderer styles', () => {
  const rules = []
  for (const file of fs.readdirSync(STYLES).filter(f => f.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(STYLES, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const z = body.match(/z-index:\s*(\d+)/)
      if (z) rules.push({ selector: selector.trim(), z: Number(z[1]), file })
    }
  }
  const toast = rules.find(r => r.selector === '#toast-stack')
  assert.ok(toast, '#toast-stack has a z-index')
  for (const r of rules.filter(r => r !== toast)) {
    assert.ok(toast.z > r.z, `${r.selector} (${r.file}: ${r.z}) is above the toasts (${toast.z})`)
  }
})
