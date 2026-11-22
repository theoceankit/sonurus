// The main process listens to WS /ws/queue of the backend, as the window does: for the
// signals of a call (mic_app_active, call_ended) while the window may be closed to the
// tray, and for the live recording of the last snapshot. A lost connection (the backend
// restarted) is made again.
function watchBackendEvents({
  url, onEvent, onSnapshot = () => {}, onDisconnect = () => {}, WebSocketImpl = globalThis.WebSocket, retryMs = 2000, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let socket = null
  let timer = null
  let closed = false
  let recording = null

  const schedule = () => {
    if (closed || timer) return
    timer = setTimer(() => { timer = null; connect() }, retryMs)
  }

  function connect() {
    if (closed) return
    try {
      socket = new WebSocketImpl(url)
    } catch {
      schedule()
      return
    }
    socket.onmessage = message => {
      let event
      try { event = JSON.parse(message.data) } catch { return }
      if (!event || typeof event !== 'object') return
      if (event.type === 'snapshot') {
        recording = event.recording ?? null
        onSnapshot(event)
      }
      else if (event.type !== 'heartbeat') onEvent(event)
    }
    socket.onerror = () => {} // a close follows
    socket.onclose = () => {
      socket = null
      if (!closed) onDisconnect()
      schedule()
    }
  }

  connect()
  return {
    recording: () => recording,
    close() {
      closed = true
      if (timer) clearTimer(timer)
      timer = null
      socket?.close()
    },
  }
}

module.exports = { watchBackendEvents }
