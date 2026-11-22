// The main process follows WS /ws/queue: the tray menu has to know when the connection
// is lost, as the last snapshot then says nothing about the recording.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { watchBackendEvents } = require(path.join(ROOT, 'electron', 'backend-events.js'))

const live = { phase: 'live', title: 'Call' }
const snapshot = recording => ({ data: JSON.stringify({ type: 'snapshot', recording }) })

function watch() {
  const sockets = []
  class FakeSocket {
    constructor() { sockets.push(this) }
    close() { this.onclose() }
  }
  const timers = []
  const seen = { snapshots: [], disconnects: 0 }
  const events = watchBackendEvents({
    url: 'ws://test',
    onEvent() {},
    onSnapshot: event => seen.snapshots.push(event.recording),
    onDisconnect: () => { seen.disconnects += 1 },
    WebSocketImpl: FakeSocket,
    setTimer: fn => { timers.push(fn); return timers.length },
    clearTimer() {},
  })
  return { events, sockets, timers, seen }
}

test('a lost connection is told, and the last recording stays for the call prompts', () => {
  const { events, sockets, seen } = watch()
  sockets[0].onmessage(snapshot(live))
  sockets[0].onclose()
  assert.equal(seen.disconnects, 1)
  assert.deepEqual(events.recording(), live)
})

test('after a new connection its snapshot tells the recording', () => {
  const { events, sockets, timers, seen } = watch()
  sockets[0].onmessage(snapshot(live))
  sockets[0].onclose()
  timers.shift()()
  sockets[1].onmessage(snapshot(null))
  assert.deepEqual(seen.snapshots, [live, null])
  assert.equal(events.recording(), null)
})

test('closing the watch on purpose is not a lost connection', () => {
  const { events, seen } = watch()
  events.close()
  assert.equal(seen.disconnects, 0)
})

test('onDisconnect is optional', () => {
  let socket
  class FakeSocket { constructor() { socket = this } }
  watchBackendEvents({ url: 'ws://test', onEvent() {}, WebSocketImpl: FakeSocket, setTimer: () => 1, clearTimer() {} })
  assert.doesNotThrow(() => socket.onclose())
})
