import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createBackendClient } from './backend-client'
import { connectQueueEvents } from './queue-events'

class FakeSocket {
  static opened: FakeSocket[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
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
const last = () => FakeSocket.opened[FakeSocket.opened.length - 1]

beforeEach(() => {
  FakeSocket.opened = []
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

test('passes events on and swallows heartbeats', () => {
  const events: unknown[] = []
  connectQueueEvents({ url: 'ws://x/ws/queue', onEvent: e => events.push(e), WebSocketImpl })
  last().receive({ type: 'snapshot', jobs: [] })
  last().receive({ type: 'heartbeat' })
  last().receive({ type: 'job_done', job_id: 'a', title: 't', transcript_id: 1 })
  expect(events.map(e => (e as { type: string }).type)).toEqual(['snapshot', 'job_done'])
})

test('reconnects two seconds after the connection drops', () => {
  connectQueueEvents({ url: 'ws://x/ws/queue', onEvent: () => {}, WebSocketImpl })
  last().onclose?.()
  vi.advanceTimersByTime(1999)
  expect(FakeSocket.opened).toHaveLength(1)
  vi.advanceTimersByTime(1)
  expect(FakeSocket.opened).toHaveLength(2)
})

test('keeps trying while the backend is away and delivers after it is back', () => {
  const events: unknown[] = []
  connectQueueEvents({ url: 'ws://x/ws/queue', onEvent: e => events.push(e), WebSocketImpl })
  for (let attempt = 0; attempt < 3; attempt++) {
    last().onclose?.()
    vi.advanceTimersByTime(2000)
  }
  expect(FakeSocket.opened).toHaveLength(4)
  last().receive({ type: 'snapshot', jobs: [] })
  expect(events).toHaveLength(1)
})

test('stays closed after the unsubscribe', () => {
  const stop = connectQueueEvents({ url: 'ws://x/ws/queue', onEvent: () => {}, WebSocketImpl })
  const socket = last()
  stop()
  expect(socket.closed).toBe(true)
  vi.advanceTimersByTime(10000)
  expect(FakeSocket.opened).toHaveLength(1)
})

test('an unsubscribe during the wait cancels the reconnect', () => {
  const stop = connectQueueEvents({ url: 'ws://x/ws/queue', onEvent: () => {}, WebSocketImpl })
  last().onclose?.()
  stop()
  vi.advanceTimersByTime(10000)
  expect(FakeSocket.opened).toHaveLength(1)
})

test('tells when the connection is lost and when it is back, and nothing at the first opening', () => {
  const changes: boolean[] = []
  connectQueueEvents({ url: 'ws://x/ws/queue', onEvent: () => {}, onConnection: c => changes.push(c), WebSocketImpl })
  last().onopen?.()
  expect(changes).toEqual([])
  last().onclose?.()
  expect(changes).toEqual([false])
  vi.advanceTimersByTime(2000)
  last().onclose?.()
  vi.advanceTimersByTime(2000)
  expect(changes).toEqual([false])
  last().onopen?.()
  expect(changes).toEqual([false, true])
})

test('a first attempt that fails counts as lost', () => {
  const changes: boolean[] = []
  connectQueueEvents({ url: 'ws://x/ws/queue', onEvent: () => {}, onConnection: c => changes.push(c), WebSocketImpl })
  last().onclose?.()
  expect(changes).toEqual([false])
})

test('stopping is not a lost connection', () => {
  const changes: boolean[] = []
  const stop = connectQueueEvents({ url: 'ws://x/ws/queue', onEvent: () => {}, onConnection: c => changes.push(c), WebSocketImpl })
  last().onopen?.()
  stop()
  expect(changes).toEqual([])
})

test('the backend client connects to the queue on its own address', () => {
  const client = createBackendClient({ baseUrl: 'http://localhost:8000', WebSocketImpl })
  client.subscribeQueueEvents(() => {})
  expect(last().url).toBe('ws://localhost:8000/ws/queue')
})
