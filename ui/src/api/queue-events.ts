import { connectEventSocket, type EventSocketOptions } from './event-socket'
import type { QueueUpdate } from './types'

// WS /ws/queue: a snapshot on connecting, then every snapshot and job event.
// Reconnects while the backend restarts, until the returned function is called.
export function connectQueueEvents(options: EventSocketOptions<QueueUpdate>): () => void {
  return connectEventSocket<QueueUpdate>(options)
}
