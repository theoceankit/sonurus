// An export goes to the file picked in the save dialog, in the format picked before it.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { exportFileName, exportTarget, saveExport } = require(path.join(ROOT, 'electron', 'export-file.js'))

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

test('the file always ends in the format picked', () => {
  assert.deepEqual(exportTarget('/a/call.json', 'json'), { filePath: '/a/call.json', extended: false })
  assert.deepEqual(exportTarget('/a/call.MD', 'md'), { filePath: '/a/call.MD', extended: false })
  assert.deepEqual(exportTarget('/a/call', 'json'), { filePath: '/a/call.json', extended: true })
  assert.deepEqual(exportTarget('/a/call.txt', 'json'), { filePath: '/a/call.txt.json', extended: true })
  assert.deepEqual(exportTarget('/a/v1.2 sync', 'txt'), { filePath: '/a/v1.2 sync.txt', extended: true })
})

for (const format of ['txt', 'md', 'json']) {
  test(`writes ${format} in UTF-8, and the dialog offers only that format`, async t => {
    const { dir, calls, deps } = setup(t, `call.${format}`)
    assert.deepEqual(await saveExport({ title: 'Call', format, text: `Привет ${format}` }, deps), { status: 'saved' })
    assert.equal(fs.readFileSync(path.join(dir, `call.${format}`), 'utf8'), `Привет ${format}`)
    const [options] = calls.dialog
    assert.equal(options.defaultPath, `Call.${format}`)
    assert.deepEqual(options.filters.map(filter => filter.extensions), [[format]])
    assert.ok(options.properties.includes('showOverwriteConfirmation'))
  })
}

test('a name left with another extension still gets the format picked', async t => {
  const { dir, deps } = setup(t, 'call.txt')
  await saveExport({ title: 'Call', format: 'json', text: '{}' }, deps)
  assert.equal(fs.readFileSync(path.join(dir, 'call.txt.json'), 'utf8'), '{}')
  assert.equal(fs.existsSync(path.join(dir, 'call.txt')), false)
})

test('a format that is not offered opens no dialog', async t => {
  const { calls, deps } = setup(t, 'call.srt')
  assert.equal((await saveExport({ title: 'Call', format: 'srt', text: 'x' }, deps)).status, 'failed')
  assert.equal(calls.dialog.length, 0)
})

test('the next dialog opens in the folder of this export', async t => {
  const { dir, calls, deps } = setup(t, 'call.txt')
  await saveExport({ title: 'One', format: 'txt', text: 'x' }, deps)
  await saveExport({ title: 'Two', format: 'txt', text: 'x' }, deps)
  assert.equal(calls.dialog[1].defaultPath, path.join(dir, 'Two.txt'))
})

test('a cancelled dialog writes nothing and remembers nothing', async t => {
  const { dir, deps } = setup(t, null)
  assert.deepEqual(await saveExport({ title: 'Call', format: 'txt', text: 'x' }, deps), { status: 'canceled' })
  assert.deepEqual(fs.readdirSync(dir), [])
})

test('an added extension that would replace a file asks first', async t => {
  const { dir, calls, deps } = setup(t, 'call', { replace: false })
  fs.writeFileSync(path.join(dir, 'call.txt'), 'kept')
  assert.deepEqual(await saveExport({ title: 'Call', format: 'txt', text: 'new' }, deps), { status: 'canceled' })
  assert.deepEqual(calls.confirm, [path.join(dir, 'call.txt')])
  assert.equal(fs.readFileSync(path.join(dir, 'call.txt'), 'utf8'), 'kept')
})

test('an added extension replaces the file once confirmed', async t => {
  const { dir, deps } = setup(t, 'call')
  fs.writeFileSync(path.join(dir, 'call.txt'), 'old')
  assert.deepEqual(await saveExport({ title: 'Call', format: 'txt', text: 'new' }, deps), { status: 'saved' })
  assert.equal(fs.readFileSync(path.join(dir, 'call.txt'), 'utf8'), 'new')
})

test('a write that fails says why', async t => {
  const { deps } = setup(t, path.join('no-such-folder', 'call.txt'))
  const result = await saveExport({ title: 'Call', format: 'txt', text: 'x' }, deps)
  assert.equal(result.status, 'failed')
  assert.match(result.message, /ENOENT/)
})

test('no text writes nothing and opens no dialog', async t => {
  const { dir, calls, deps } = setup(t, 'call.md')
  assert.equal((await saveExport({ title: 'Call', format: 'md' }, deps)).status, 'failed')
  assert.equal(calls.dialog.length, 0)
  assert.equal(fs.existsSync(path.join(dir, 'call.md')), false)
})

test('a write that fails halfway leaves the file it was to replace as it was', async t => {
  const { dir, deps } = setup(t, 'call.txt')
  const file = path.join(dir, 'call.txt')
  fs.writeFileSync(file, 'the export before')
  const write = fs.promises.writeFile
  t.mock.method(fs.promises, 'writeFile', async (to, text, options) => {
    await write(to, text.slice(0, 3), options)
    throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
  })
  const result = await saveExport({ title: 'Call', format: 'txt', text: 'the new export' }, deps)
  assert.deepEqual(result, { status: 'failed', message: 'ENOSPC: no space left on device, write' })
  assert.equal(fs.readFileSync(file, 'utf8'), 'the export before')
  assert.deepEqual(fs.readdirSync(dir), ['call.txt'])
})

test('a failed write names the file picked', async t => {
  const { dir, deps } = setup(t, path.join('no-such-folder', 'call.txt'))
  const { message } = await saveExport({ title: 'Call', format: 'txt', text: 'x' }, deps)
  assert.ok(message.includes(path.join(dir, 'no-such-folder', 'call.txt')), message)
})

const POSIX = { skip: process.platform === 'win32' && 'POSIX file modes and links' }

test('a file replaced keeps its permissions', POSIX, async t => {
  const { dir, deps } = setup(t, 'call.txt')
  const file = path.join(dir, 'call.txt')
  fs.writeFileSync(file, 'old')
  fs.chmodSync(file, 0o600)
  assert.deepEqual(await saveExport({ title: 'Call', format: 'txt', text: 'new' }, deps), { status: 'saved' })
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
})

test('a link stays a link, and the file it points to is replaced', POSIX, async t => {
  const { dir, deps } = setup(t, 'call.txt')
  fs.writeFileSync(path.join(dir, 'real.txt'), 'old')
  fs.symlinkSync('real.txt', path.join(dir, 'call.txt'))
  assert.deepEqual(await saveExport({ title: 'Call', format: 'txt', text: 'new' }, deps), { status: 'saved' })
  assert.ok(fs.lstatSync(path.join(dir, 'call.txt')).isSymbolicLink())
  assert.equal(fs.readFileSync(path.join(dir, 'real.txt'), 'utf8'), 'new')
})

test('a file that may not be written is not replaced', { skip: POSIX.skip || (process.getuid?.() === 0 && 'root writes any file') }, async t => {
  const { dir, deps } = setup(t, 'call.txt')
  const file = path.join(dir, 'call.txt')
  fs.writeFileSync(file, 'old')
  fs.chmodSync(file, 0o444)
  assert.equal((await saveExport({ title: 'Call', format: 'txt', text: 'new' }, deps)).status, 'failed')
  assert.equal(fs.readFileSync(file, 'utf8'), 'old')
})

for (const [what, title] of [['Chinese', '会'.repeat(200)], ['Cyrillic', 'ж'.repeat(200)], ['emoji', `a${'😀'.repeat(200)}`]]) {
  test(`a long title in ${what} gives a name the file system takes`, async t => {
    for (const format of ['txt', 'md', 'json']) {
      const name = exportFileName(title, format)
      assert.ok(Buffer.byteLength(name) <= 255, `${Buffer.byteLength(name)} bytes`)
      assert.ok(name.endsWith(`.${format}`))
      assert.doesNotMatch(name, /\p{Surrogate}/u, 'no character is cut in half')
      assert.ok(title.startsWith(name.slice(0, -format.length - 1)))
      const { deps } = setup(t, name)
      assert.deepEqual(await saveExport({ title, format, text: 'x' }, deps), { status: 'saved' })
    }
  })
}
