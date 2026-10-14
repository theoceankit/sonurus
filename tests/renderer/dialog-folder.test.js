// The file dialog opens in the folder of the last picked file, also after a
// restart: Electron 43+ opens Downloads and the OS no longer remembers it.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { dialogFolder, rememberDialogFolder } = require(path.join(ROOT, 'electron', 'dialog-folder.js'))

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-dialog-'))
  return { dir, state: path.join(dir, 'user-data', 'dialog-state.json'), done: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('first run: no saved folder → the system decides', () => {
  const t = tmp()
  try {
    assert.equal(dialogFolder(t.state), undefined)
  } finally { t.done() }
})

test('the folder of the picked file is remembered across restarts', () => {
  const t = tmp()
  try {
    const audio = path.join(t.dir, 'meetings')
    fs.mkdirSync(audio)
    rememberDialogFolder(t.state, path.join(audio, 'call.wav'))
    assert.equal(dialogFolder(t.state), audio)
    assert.ok(fs.existsSync(t.state), 'kept on disk, so a restart still knows it')
  } finally { t.done() }
})

test('a later pick replaces the folder', () => {
  const t = tmp()
  try {
    const a = path.join(t.dir, 'a')
    const b = path.join(t.dir, 'b')
    fs.mkdirSync(a)
    fs.mkdirSync(b)
    rememberDialogFolder(t.state, path.join(a, '1.wav'))
    rememberDialogFolder(t.state, path.join(b, '2.wav'))
    assert.equal(dialogFolder(t.state), b)
  } finally { t.done() }
})

test('the saved folder was deleted → the system decides', () => {
  const t = tmp()
  try {
    const gone = path.join(t.dir, 'gone')
    fs.mkdirSync(gone)
    rememberDialogFolder(t.state, path.join(gone, 'call.wav'))
    fs.rmSync(gone, { recursive: true })
    assert.equal(dialogFolder(t.state), undefined)
  } finally { t.done() }
})

test('a damaged state file → the system decides, the next pick repairs it', () => {
  const t = tmp()
  try {
    fs.mkdirSync(path.dirname(t.state), { recursive: true })
    fs.writeFileSync(t.state, '{not json')
    assert.equal(dialogFolder(t.state), undefined)
    rememberDialogFolder(t.state, path.join(t.dir, 'call.wav'))
    assert.equal(dialogFolder(t.state), t.dir)
  } finally { t.done() }
})

test('main.js opens the file dialog in the remembered folder and remembers the pick', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')
  const handler = main.slice(main.indexOf("ipcMain.handle('open-files'"))
  const body = handler.slice(0, handler.indexOf('\n})') + 3)
  assert.match(body, /defaultPath:\s*dialogFolder\(/)
  assert.match(body, /rememberDialogFolder\(/)
})
