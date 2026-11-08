// WS /ws/models/{job_id} is not in the OpenAPI schema: its events are typed here.
// Heartbeats only keep the connection alive and are not passed on.
export type ModelDownloadEvent =
  | { type: 'progress'; pct: number }
  | { type: 'done' }
  | { type: 'cancelled' }
  // code: why, for the interface to say (transcribe/download-errors.ts); none when the
  // job is unknown to the backend or the connection is lost.
  | { type: 'error'; message: string; code?: string }

type Message = ModelDownloadEvent | { type: 'heartbeat' }

export const isFinal = (event: ModelDownloadEvent) => event.type !== 'progress'

// One download's progress until it ends. A connection that drops before the end is
// an error: the download may go on, but nothing here can follow it any more.
export function watchModelDownload(url: string, listener: (event: ModelDownloadEvent) => void, WebSocketImpl: typeof WebSocket = WebSocket): () => void {
  let ended = false
  const socket = new WebSocketImpl(url)
  const end = (event: ModelDownloadEvent) => {
    if (ended) return
    if (isFinal(event)) ended = true
    listener(event)
  }
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data) as Message
    if (message.type !== 'heartbeat') end(message)
  }
  socket.onclose = () => end({ type: 'error', message: 'The connection to the backend was lost.' })
  return () => {
    ended = true
    socket.close()
  }
}
