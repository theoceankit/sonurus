// An export goes to the file picked in the save dialog, in the format of its extension.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { exportFileName, exportTarget, saveExport } = require(path.join(ROOT, 'electron', 'export-file.js'))

const contents = { txt: 'as text', md: '# as markdown', json: '{"as":"json"}' }

function setup(t, chosen, { replace = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-export-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const calls = { dialog: [], confirm: [] }
  const deps = {
    statePath: path.join(dir, 'state', 'export-dialog-state.json'),
    showSaveDialog: async options => {
      calls.dialog.push(options)
      return chosen === null ? { canceled: true } : { canceled: false, filePath: path.join(dir, chosen) }
    },
    confirmReplace: async file => { calls.confirm.push(file); return replace },
  }
  return { dir, calls, deps }
}

test('the file name is the title, safe on every system', () => {
  assert.equal(exportFileName('Weekly sync', 'md'), 'Weekly sync.md')
  assert.equal(exportFileName('a/b\\c:d*e?"f<g>h|i\n', 'txt'), 'a b c d e f g h i.txt')
  assert.equal(exportFileName('  ...  ', 'json'), 'Transcript.json')
  assert.equal(exportFileName('../../etc/passwd', 'txt'), 'etc passwd.txt')
  assert.ok(exportFileName('x'.repeat(500), 'txt').length <= 124)
})

test('the extension says the format; without a known one the default is added', () => {
  assert.deepEqual(exportTarget('/a/call.MD', 'txt'), { filePath: '/a/call.MD', format: 'md', extended: false })
  assert.deepEqual(exportTarget('/a/call', 'json'), { filePath: '/a/call.json', format: 'json', extended: true })
  assert.deepEqual(exportTarget('/a/v1.2 sync', 'txt'), { filePath: '/a/v1.2 sync.txt', format: 'txt', extended: true })
})

for (const format of ['txt', 'md', 'json']) {
  test(`writes the text of ${format} in UTF-8`, async t => {
    const { dir, deps } = setup(t, `call.${format}`)
    const text = { ...contents, [format]: `Привет ${format}` }
    assert.deepEqual(await saveExport({ title: 'Call', format: 'txt', contents: text }, deps), { status: 'saved' })
    assert.equal(fs.readFileSync(path.join(dir, `call.${format}`), 'utf8'), `Привет ${format}`)
  })
}

test('the dialog starts on the default format and asks before replacing', async t => {
  const { calls, deps } = setup(t, 'call.md')
  await saveExport({ title: 'Call', format: 'md', contents }, deps)
  const [options] = calls.dialog
  assert.equal(options.defaultPath, 'Call.md')
  assert.deepEqual(options.filters.map(filter => filter.extensions[0]), ['md', 'txt', 'json'])
  assert.ok(options.properties.includes('showOverwriteConfirmation'))
})

test('a saved format that is no longer there starts on txt', async t => {
  const { calls, deps } = setup(t, 'call.txt')
  await saveExport({ title: 'Call', format: 'srt', contents }, deps)
  assert.equal(calls.dialog[0].defaultPath, 'Call.txt')
})

test('the next dialog opens in the folder of this export', async t => {
  const { dir, calls, deps } = setup(t, 'call.txt')
  await saveExport({ title: 'One', format: 'txt', contents }, deps)
  await saveExport({ title: 'Two', format: 'txt', contents }, deps)
  assert.equal(calls.dialog[1].defaultPath, path.join(dir, 'Two.txt'))
})

test('a cancelled dialog writes nothing and remembers nothing', async t => {
  const { dir, deps } = setup(t, null)
  assert.deepEqual(await saveExport({ title: 'Call', format: 'txt', contents }, deps), { status: 'canceled' })
  assert.deepEqual(fs.readdirSync(dir), [])
})

test('an added extension that would replace a file asks first', async t => {
  const { dir, calls, deps } = setup(t, 'call', { replace: false })
  fs.writeFileSync(path.join(dir, 'call.txt'), 'kept')
  assert.deepEqual(await saveExport({ title: 'Call', format: 'txt', contents }, deps), { status: 'canceled' })
  assert.deepEqual(calls.confirm, [path.join(dir, 'call.txt')])
  assert.equal(fs.readFileSync(path.join(dir, 'call.txt'), 'utf8'), 'kept')
})

test('an added extension replaces the file once confirmed', async t => {
  const { dir, deps } = setup(t, 'call')
  fs.writeFileSync(path.join(dir, 'call.txt'), 'old')
  assert.deepEqual(await saveExport({ title: 'Call', format: 'txt', contents }, deps), { status: 'saved' })
  assert.equal(fs.readFileSync(path.join(dir, 'call.txt'), 'utf8'), 'as text')
})

test('a write that fails says why', async t => {
  const { deps } = setup(t, path.join('no-such-folder', 'call.txt'))
  const result = await saveExport({ title: 'Call', format: 'txt', contents }, deps)
  assert.equal(result.status, 'failed')
  assert.match(result.message, /ENOENT/)
})

test('no text for the format writes nothing', async t => {
  const { dir, deps } = setup(t, 'call.md')
  const result = await saveExport({ title: 'Call', format: 'txt', contents: { txt: 'only' } }, deps)
  assert.equal(result.status, 'failed')
  assert.equal(fs.existsSync(path.join(dir, 'call.md')), false)
})
