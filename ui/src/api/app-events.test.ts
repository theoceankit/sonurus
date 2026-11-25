import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { connectAppEvents } from './app-events'
import { createBackendClient } from './backend-client'

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
const changed = { type: 'note_changed', transcript_id: 7, version: 3, writer: { kind: 'mcp', name: 'Claude Code' } }

beforeEach(() => {
  FakeSocket.opened = []
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

test('passes connected and note_changed on and swallows heartbeats', () => {
  const events: unknown[] = []
  connectAppEvents({ url: 'ws://x/ws/events', onEvent: e => events.push(e), WebSocketImpl })
  last().receive({ type: 'connected' })
  last().receive({ type: 'heartbeat' })
  last().receive(changed)
  expect(events).toEqual([{ type: 'connected' }, changed])
})

test('reconnects after the connection drops and says connected again', () => {
  const events: unknown[] = []
  connectAppEvents({ url: 'ws://x/ws/events', onEvent: e => events.push(e), WebSocketImpl })
  last().onclose?.()
  vi.advanceTimersByTime(2000)
  expect(FakeSocket.opened).toHaveLength(2)
  last().receive({ type: 'connected' })
  expect(events).toEqual([{ type: 'connected' }])
})

test('stays closed after the unsubscribe', () => {
  const stop = connectAppEvents({ url: 'ws://x/ws/events', onEvent: () => {}, WebSocketImpl })
  stop()
  vi.advanceTimersByTime(10000)
  expect(FakeSocket.opened).toHaveLength(1)
})

test('the backend client listens on /ws/events', () => {
  const client = createBackendClient({ WebSocketImpl })
  const events: unknown[] = []
  const stop = client.subscribeAppEvents(e => events.push(e))
  expect(last().url).toBe('ws://localhost:8000/ws/events')
  last().receive(changed)
  expect(events).toEqual([changed])
  stop()
})
