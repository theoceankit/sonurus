// Ctrl/⌘+click on a link in a note opens it outside the app, web and mail only.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { openLink } = require(path.join(ROOT, 'electron', 'links.js'))

function opener() {
  const opened = []
  return { opened, openExternal: async url => { opened.push(url) } }
}

test('web and mail addresses open', async () => {
  const system = opener()
  assert.equal(await openLink('https://example.com/a b', system), true)
  assert.equal(await openLink('http://example.com', system), true)
  assert.equal(await openLink('mailto:design@example.com', system), true)
  assert.deepEqual(system.opened, ['https://example.com/a%20b', 'http://example.com/', 'mailto:design@example.com'])
})

test('anything else is refused and nothing opens', async () => {
  const system = opener()
  for (const address of ['file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share', 'roadmap', '', null, 42]) {
    assert.equal(await openLink(address, system), false, String(address))
  }
  assert.deepEqual(system.opened, [])
})
