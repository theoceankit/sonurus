// makeDropdown (components.js): an option with `disabled: true` is shown
// dimmed and cannot be picked; other options work as before.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')
const { fakeElement } = require('./fake-dom')

function dropdown(options, value) {
  const created = []
  const picked = []
  const ctx = loadRenderer(['components.js'], {
    document: { createElement: () => fakeElement(created), createTextNode: text => ({ text }), addEventListener() {} },
    icon: () => '',
    setTimeout,
  })
  ctx.makeDropdown(options, value, v => picked.push(v))
  const item = label => created.find(e => e.className.startsWith('st-dropdown-item') && e.textContent === label)
  return { item, picked }
}

const OPTIONS = [
  { value: 'tiny', label: 'Tiny', disabled: true },
  { value: 'base', label: 'Base' },
]

test('makeDropdown: a disabled option is marked and does not call onChange', () => {
  const d = dropdown(OPTIONS, 'base')
  const tiny = d.item('Tiny')
  assert.match(tiny.className, /st-dropdown-item--disabled/)
  assert.equal(tiny.disabled, true)
  tiny.fire('click')
  assert.deepEqual(d.picked, [])
})

test('makeDropdown: an option without `disabled` is picked as before', () => {
  const d = dropdown(OPTIONS, 'tiny')
  const base = d.item('Base')
  assert.doesNotMatch(base.className, /disabled/)
  base.fire('click')
  assert.deepEqual(d.picked, ['base'])
})
