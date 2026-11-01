import type { QueueEvent, QueueUpdate } from './types'

const RECONNECT_MS = 2000

type QueueEventsOptions = {
  url: string
  onEvent: (event: QueueUpdate) => void
  WebSocketImpl?: typeof WebSocket
}

// WS /ws/queue: a snapshot on connecting, then every snapshot and job event.
// Reconnects while the backend restarts, until the returned function is called.
export function connectQueueEvents({ url, onEvent, WebSocketImpl = WebSocket }: QueueEventsOptions): () => void {
  let closed = false
  let socket: WebSocket
  let reconnect: ReturnType<typeof setTimeout>

  const connect = () => {
    socket = new WebSocketImpl(url)
    socket.onmessage = ({ data }) => {
      const event = JSON.parse(data) as QueueEvent
      if (event.type !== 'heartbeat') onEvent(event)
    }
    socket.onclose = () => {
      if (!closed) reconnect = setTimeout(connect, RECONNECT_MS)
    }
  }
  connect()

  return () => {
    closed = true
    clearTimeout(reconnect)
    socket.close()
  }
}
