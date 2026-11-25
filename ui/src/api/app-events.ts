import { connectEventSocket, type EventSocketOptions } from './event-socket'
import type { AppEvent } from './types'

// WS /ws/events: connected once it hears every event, then what changed in the app's
// data, whoever changed it (note_changed). Reconnects while the backend restarts,
// with connected again: what changed meanwhile was missed.
export function connectAppEvents(options: EventSocketOptions<AppEvent>): () => void {
  return connectEventSocket<AppEvent>(options)
}
