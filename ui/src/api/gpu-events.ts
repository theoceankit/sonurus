// WS /ws/gpu/{job_id} is not in the OpenAPI schema: its events are typed here.
// Heartbeats only keep the connection alive and are not passed on.
export type GpuDownloadEvent =
  | { type: 'progress'; phase: 'download'; pct: number }
  | { type: 'progress'; phase: 'install' }
  | { type: 'done' }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }

// POST /gpu/restart: ready when the app may restart the backend now, otherwise what
// the backend waits for. Nothing to apply is a 409.
export type GpuRestartAnswer =
  | { status: 'ready' }
  | { status: 'waiting'; reason?: GpuWaitReason | null }

export type GpuWaitReason = 'transcription' | 'recording' | 'model_download' | 'gpu_download'

type Message = GpuDownloadEvent | { type: 'heartbeat' }

// One download's progress until it ends. A connection that drops before the end is
// an error: nothing here can follow the download any more.
export function watchGpuDownload(url: string, listener: (event: GpuDownloadEvent) => void, WebSocketImpl: typeof WebSocket = WebSocket): () => void {
  let ended = false
  const socket = new WebSocketImpl(url)
  const end = (event: GpuDownloadEvent) => {
    if (ended) return
    if (event.type !== 'progress') ended = true
    listener(event)
  }
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data) as Message
    if (message.type !== 'heartbeat') end(message)
  }
  socket.onclose = () => end({ type: 'error', message: 'the connection to the backend was lost' })
  return () => {
    ended = true
    socket.close()
  }
}
