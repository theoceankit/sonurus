const RECONNECT_MS = 2000

export type EventSocketOptions<T> = {
  url: string
  onEvent: (event: T) => void
  // Told when the connection is lost and when it is back, not of the first opening.
  onConnection?: (connected: boolean) => void
  WebSocketImpl?: typeof WebSocket
}

// A WebSocket of the backend's events (JSON with a type), heartbeats left out.
// Reconnects while the backend restarts, until the returned function is called.
export function connectEventSocket<T extends { type: string }>({ url, onEvent, onConnection, WebSocketImpl = WebSocket }: EventSocketOptions<T>): () => void {
  let closed = false
  let socket: WebSocket
  let reconnect: ReturnType<typeof setTimeout>
  let lost = false

  const connect = () => {
    socket = new WebSocketImpl(url)
    socket.onopen = () => {
      if (lost) onConnection?.(true)
      lost = false
    }
    socket.onmessage = ({ data }) => {
      const event = JSON.parse(data) as T
      if (event.type !== 'heartbeat') onEvent(event)
    }
    socket.onclose = () => {
      if (closed) return
      if (!lost) onConnection?.(false)
      lost = true
      reconnect = setTimeout(connect, RECONNECT_MS)
    }
  }
  connect()

  return () => {
    closed = true
    clearTimeout(reconnect)
    socket.close()
  }
}
