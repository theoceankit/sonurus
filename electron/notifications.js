// Notifications of the main process. The system may refuse one: macOS for an app it
// does not allow to notify, Windows with notifications turned off for the app. Electron
// says so with 'failed' (macOS and Windows), or Notification.isSupported() is false; a
// refusal goes to the log and is kept for Settings → Notifications until a notification
// shows again.

const fs = require('fs')
const path = require('path')

const UNSUPPORTED = 'notifications are not supported on this system'

// Notification: Electron's class. log(line): the main process log. onRefused({ title,
// error }) and onShown() hear about every notification.
function createNotifier({ Notification, log, onRefused, onShown }) {
  // On screen: kept from the garbage collector, which would drop their click.
  const kept = new Set()

  const refused = (title, error) => {
    log(`[notifications] "${title}" not shown: ${error}`)
    onRefused?.({ title, error })
  }

  // onClick: a click on it; onShow: the system showed it. Returns { close }, which takes
  // it off the screen (a summary replacing it).
  function notify({ title, body }, { onClick, onShow } = {}) {
    if (!Notification.isSupported()) {
      refused(title, UNSUPPORTED)
      return { close() {} }
    }
    const notification = new Notification({ title, body })
    kept.add(notification)
    const forget = () => kept.delete(notification)
    notification.on('show', () => {
      onShown?.()
      onShow?.()
    })
    notification.on('click', () => { forget(); onClick?.() })
    notification.on('close', forget)
    notification.on('failed', (_event, error) => {
      forget()
      refused(title, String(error))
    })
    notification.show()
    return {
      close() {
        forget()
        notification.close()
      },
    }
  }

  return { notify, onScreen: () => kept.size }
}

function readState(statePath) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    return state && typeof state === 'object' ? state : {}
  } catch { return {} }
}

// The last refusal, { title, error }, or null.
function notificationRefusal(statePath) {
  const refusal = readState(statePath).notificationRefusal
  if (!refusal || typeof refusal !== 'object' || typeof refusal.error !== 'string') return null
  return { title: String(refusal.title ?? ''), error: refusal.error }
}

// Kept in app-state.json; null clears it.
function rememberNotificationRefusal(statePath, refusal) {
  const { notificationRefusal: _old, ...rest } = readState(statePath)
  const state = refusal ? { ...rest, notificationRefusal: { title: refusal.title, error: refusal.error } } : rest
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(statePath, JSON.stringify(state), 'utf8')
  } catch { /* the log still has it */ }
}

module.exports = { createNotifier, notificationRefusal, rememberNotificationRefusal }
