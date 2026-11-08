import { beforeEach, expect, test } from 'vitest'
import { watchModelDownload, type ModelDownloadEvent } from './model-download-events'

class FakeSocket {
  static opened: FakeSocket[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  closed = false
  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeSocket.opened.push(this)
  }

  receive(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }

  close() {
    this.closed = true
    this.onclose?.()
  }
}

const WebSocketImpl = FakeSocket as unknown as typeof WebSocket

beforeEach(() => { FakeSocket.opened = [] })

function watch() {
  const events: ModelDownloadEvent[] = []
  const stop = watchModelDownload('ws://x/ws/models/j', event => events.push(event), WebSocketImpl)
  return { events, stop, socket: FakeSocket.opened[0] }
}

test('passes progress on until the end, without heartbeats', () => {
  const { events, socket } = watch()
  expect(socket.url).toBe('ws://x/ws/models/j')
  socket.receive({ type: 'progress', pct: 12.5 })
  socket.receive({ type: 'heartbeat' })
  socket.receive({ type: 'done' })
  socket.close()
  expect(events).toEqual([{ type: 'progress', pct: 12.5 }, { type: 'done' }])
})

test('a connection that drops before the end is an error, once', () => {
  const { events, socket } = watch()
  socket.receive({ type: 'progress', pct: 40 })
  socket.close()
  socket.close()
  expect(events).toEqual([{ type: 'progress', pct: 40 }, { type: 'error', message: 'The connection to the backend was lost.' }])
})

test('stopping closes the connection and says nothing more', () => {
  const { events, stop, socket } = watch()
  stop()
  expect(socket.closed).toBe(true)
  expect(events).toEqual([])
})

test('an unreadable message ends the watch with an error and closes the connection', () => {
  const { events, socket } = watch()
  socket.onmessage?.({ data: 'not json' })
  socket.receive({ type: 'done' })
  expect(events).toEqual([{ type: 'error', message: 'The backend sent an unreadable message.' }])
  expect(socket.closed).toBe(true)
})
