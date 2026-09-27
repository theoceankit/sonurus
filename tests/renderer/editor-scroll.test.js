const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')

const { preserveScroll } = loadRenderer(['utils.js'])

// Minimal stand-in for a container whose scrollable children get replaced on rebuild.
function fakeRoot(els) {
  const root = { els, querySelector: sel => root.els[sel] || null }
  return root
}

test('preserveScroll: restores scrollTop on the rebuilt elements', () => {
  const root = fakeRoot({ '.seg-list': { scrollTop: 840 }, '.right-content': { scrollTop: 120 } })
  const restore = preserveScroll(root, ['.seg-list', '.right-content'])
  root.els = { '.seg-list': { scrollTop: 0 }, '.right-content': { scrollTop: 0 } }  // rebuild
  restore()
  assert.equal(root.els['.seg-list'].scrollTop, 840)
  assert.equal(root.els['.right-content'].scrollTop, 120)
})

test('preserveScroll: skips elements missing before or after the rebuild', () => {
  const root = fakeRoot({ '.seg-list': { scrollTop: 50 } })
  const restore = preserveScroll(root, ['.seg-list', '.right-content'])
  root.els = { '.right-content': { scrollTop: 7 } }
  assert.doesNotThrow(restore)
  assert.equal(root.els['.right-content'].scrollTop, 7)
})
