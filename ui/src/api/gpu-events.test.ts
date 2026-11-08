import { beforeEach, expect, test } from 'vitest'
import { watchGpuDownload, type GpuDownloadEvent } from './gpu-events'

class FakeSocket {
  static opened: FakeSocket[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  closed = false

  constructor() {
    FakeSocket.opened.push(this)
  }

  receive(data: string) {
    this.onmessage?.({ data })
  }

  close() {
    this.closed = true
    this.onclose?.()
  }
}

beforeEach(() => { FakeSocket.opened = [] })

function watch() {
  const events: GpuDownloadEvent[] = []
  watchGpuDownload('ws://x/ws/gpu/j', event => events.push(event), FakeSocket as unknown as typeof WebSocket)
  return { events, socket: FakeSocket.opened[0] }
}

test('passes progress on until the end, without heartbeats', () => {
  const { events, socket } = watch()
  socket.receive(JSON.stringify({ type: 'progress', phase: 'download', pct: 10 }))
  socket.receive(JSON.stringify({ type: 'heartbeat' }))
  socket.receive(JSON.stringify({ type: 'done' }))
  socket.close()
  expect(events).toEqual([{ type: 'progress', phase: 'download', pct: 10 }, { type: 'done' }])
})

test('an unreadable message ends the watch with an error and closes the connection', () => {
  const { events, socket } = watch()
  socket.receive('not json')
  expect(events).toEqual([{ type: 'error', message: 'the backend sent an unreadable message' }])
  expect(socket.closed).toBe(true)
})
