// What the main process does when the backend says a call may have started or ended
// (mic_app_active, call_ended over WS /ws/queue): a notification, an automatic stop
// or nothing, by the notification settings in settings.json.
const fs = require('fs')
const path = require('path')

// The same values as in DEFAULT_SETTINGS (electron/main.js): a settings file saved
// before these keys existed takes them.
const PROMPT_DEFAULTS = {
  notifications: true,
  promptStart: true,
  promptStartApps: 'any',
  promptStartSelected: [],
  promptEnd: 'suggest',
}

const notificationsOn = settings => settings?.notifications !== false

// { kind: 'notify', title, body, intent } — a notification whose click opens the
// window with the dialog of intent; { kind: 'stop' } — stop the recording; or null.
function promptFor(event, { settings, recording }) {
  const s = { ...PROMPT_DEFAULTS, ...settings }
  if (!notificationsOn(s)) return null
  if (event.type === 'mic_app_active') {
    if (!s.promptStart || recording) return null
    if (s.promptStartApps === 'selected' && !(s.promptStartSelected ?? []).includes(event.app_id)) return null
    return {
      kind: 'notify',
      title: event.name ? `Looks like a call started in ${event.name}` : 'Looks like a call started',
      body: 'Click to start recording.',
      intent: { dialog: 'new-recording', app: event.name ?? null },
    }
  }
  if (event.type === 'call_ended') {
    if (recording?.phase !== 'live' || s.promptEnd === 'off') return null
    if (s.promptEnd === 'auto') return { kind: 'stop' }
    return {
      kind: 'notify',
      title: 'Looks like the call ended',
      body: event.reason === 'silence' ? 'Nothing was heard for 5 minutes. Click to stop recording.' : 'Click to stop recording.',
      intent: { dialog: 'stop-recording' },
    }
  }
  return null
}

// An automatic stop is answered at once, before the recording is saved: how it ended
// comes after, over the queue events. A snapshot without the recording means saved and
// queued; recording_failed comes before that snapshot. Null until one of them.
function stopOutcome(event, title) {
  if (event.type === 'recording_failed') {
    return { title: 'Could not save the recording', body: `${event.title || title}: ${event.error}` }
  }
  if (event.type === 'snapshot' && !event.recording) return { title: 'Recording stopped and saved', body: title }
  return null
}

// No word from the backend in time (it went down): stopped, but not known to be saved.
const stopTimedOut = title => ({ title: 'Recording stopped', body: `${title}. Open Sonorus to see whether it was saved.` })

// The apps that held a microphone long enough to suggest a recording, for the list
// of Settings → Notifications. Kept in app-state.json of the main process, as
// settings.json is rewritten whole by the renderer.
function readState(statePath) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    return state && typeof state === 'object' ? state : {}
  } catch { return {} }
}

function micApps(statePath) {
  const apps = readState(statePath).micApps
  return Array.isArray(apps) ? apps.filter(a => a && typeof a.id === 'string').map(a => ({ id: a.id, name: String(a.name ?? a.id) })) : []
}

function rememberMicApp(statePath, { app_id, name }) {
  const apps = micApps(statePath)
  const entry = { id: app_id, name: name || app_id }
  const at = apps.findIndex(a => a.id === app_id)
  if (at >= 0) apps[at] = entry
  else apps.push(entry)
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(statePath, JSON.stringify({ ...readState(statePath), micApps: apps }), 'utf8')
  } catch { /* remembered next time */ }
}

// Windows shows a notification only for an app with an AppUserModelID. The
// installer's Start menu shortcut carries build.appId; a dev run has no
// shortcut, and Windows accepts its exe path instead.
const APP_ID = 'com.sonorus.app'

function appUserModelId({ isPackaged, execPath }) {
  return isPackaged ? APP_ID : execPath
}

module.exports = { PROMPT_DEFAULTS, appUserModelId, promptFor, stopOutcome, stopTimedOut, notificationsOn, micApps, rememberMicApp }
