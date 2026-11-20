// Main asks the page to save what waits before the window goes, and waits for it.
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { askWindowToFinish } = require(path.join(ROOT, 'electron', 'window-closing.js'))

function fakeWindow({ answer = true, destroyed = false } = {}) {
  const ipc = new EventEmitter()
  const sent = []
  const webContents = {
    send: (channel, id) => {
      sent.push(channel)
      if (answer) setTimeout(() => ipc.emit('window-closing-done', { sender: webContents }, id), 5)
    },
  }
  return { ipc, sent, win: { webContents, isDestroyed: () => destroyed } }
}

test('waits for the page to answer', async () => {
  const { ipc, sent, win } = fakeWindow()
  const started = Date.now()
  await askWindowToFinish(win, { ipc, timeoutMs: 5000 })
  assert.deepEqual(sent, ['window-closing'])
  assert.ok(Date.now() - started < 1000)
  assert.equal(ipc.listenerCount('window-closing-done'), 0)
})

test('a page that never answers is waited for only a while', async () => {
  const { ipc, win } = fakeWindow({ answer: false })
  const started = Date.now()
  await askWindowToFinish(win, { ipc, timeoutMs: 50 })
  assert.ok(Date.now() - started >= 45)
  assert.equal(ipc.listenerCount('window-closing-done'), 0)
})

test('an answer from another page or to another ask does not count', async () => {
  const { ipc, win } = fakeWindow({ answer: false })
  const asked = askWindowToFinish(win, { ipc, timeoutMs: 80 })
  const started = Date.now()
  ipc.emit('window-closing-done', { sender: {} }, 1)
  ipc.emit('window-closing-done', { sender: win.webContents }, -1)
  await asked
  assert.ok(Date.now() - started >= 70)
})

test('a window already gone is not asked', async () => {
  const { ipc, sent, win } = fakeWindow({ destroyed: true })
  await askWindowToFinish(win, { ipc })
  await askWindowToFinish(null, { ipc })
  assert.deepEqual(sent, [])
})
