// Closing the window keeps Sonorus running in the tray, with its backend: a recording
// or a transcription goes on, and later the app can tell the user something without a
// window. The app quits from the tray menu (or Cmd+Q on macOS), asking first while a
// recording or a transcription runs. Without a tray, closing the window quits as before.

const fs = require('fs')
const path = require('path')

// What the window's close button does: 'destroy' the window and stay in the tray, or
// 'quit'. closeToTray is the setting of settings.json, on unless it says false.
function closeAction({ closeToTray, trayAvailable }) {
  return trayAvailable && closeToTray !== false ? 'destroy' : 'quit'
}

// What to ask before quitting, from the queue snapshot (GET /queue); null to quit at once.
function quitQuestion(snapshot) {
  if (snapshot?.recording) {
    return {
      kind: 'recording',
      message: 'Recording is in progress. Stop it and quit?',
      detail: snapshot.running_job_id
        ? 'The recording is saved and queued. The transcription that runs now is interrupted and stays in the queue.'
        : 'The recording is saved and queued.',
      buttons: ['Stop and quit', 'Cancel'],
    }
  }
  if (snapshot?.running_job_id) {
    return {
      kind: 'transcription',
      message: 'Transcription will be interrupted. Quit?',
      detail: 'It stays in the queue.',
      buttons: ['Quit', 'Cancel'],
    }
  }
  return null
}

function trayMenu({ open, quit }) {
  return [
    { label: 'Open Sonorus', click: () => open() },
    { type: 'separator' },
    { label: 'Quit Sonorus', click: () => quit() },
  ]
}

// The tray icon in electron/assets. macOS: a template image (black, shape in alpha), the
// name ending in Template tells Electron so; the menu bar tints it for its light or dark
// look and takes trayTemplate@2x.png on Retina, so it is not resized. Elsewhere: the
// colour app icon, made small.
function trayIcon(platform) {
  if (platform === 'darwin') return { file: 'trayTemplate.png', size: null }
  return { file: 'icon.png', size: platform === 'win32' ? 32 : 22 }
}

// Windows and macOS always have one. On Linux the tray is the StatusNotifierItem host
// (KDE, GNOME with the AppIndicator extension, most others): Electron shows its icon
// there and says nothing when there is none, so the bus is asked whether the host is
// there. When that cannot be told (no gdbus), there is no tray: closing the window then
// quits, rather than leaving the app running with no way back to it.
async function trayAvailable({ platform, run }) {
  if (platform !== 'linux') return true
  try {
    const out = await run('gdbus', [
      'call', '--session',
      '--dest', 'org.freedesktop.DBus',
      '--object-path', '/org/freedesktop/DBus',
      '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.kde.StatusNotifierWatcher',
    ])
    return /^\(true,\)/.test(String(out).trim())
  } catch {
    return false
  }
}

const STOP_TIMEOUT_MS = 30000
const POLL_MS = 200

// Whether to go on quitting. queue() → the GET /queue snapshot, ask(question) → the
// index of the button pressed, stopRecording() → POST /audio/recording/stop. The stop
// answers at once; the recording is saved and queued after, until the snapshot has no
// recording. A backend that does not answer has nothing to lose: quit.
async function confirmQuit({ queue, ask, stopRecording, sleep, now = Date.now, timeoutMs = STOP_TIMEOUT_MS }) {
  let snapshot
  try { snapshot = await queue() } catch { return true }
  const question = quitQuestion(snapshot)
  if (!question) return true
  if (await ask(question) !== 0) return false
  if (question.kind !== 'recording') return true
  try { await stopRecording() } catch { /* stopped meanwhile: the wait below sees it */ }
  const end = now() + timeoutMs
  while (now() < end) {
    try {
      if (!(await queue())?.recording) break
    } catch { break }
    await sleep(POLL_MS)
  }
  return true
}

// The notice of the first close: kept in a file of the main process, as settings.json
// is rewritten whole by the renderer.
function readState(statePath) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    return state && typeof state === 'object' ? state : {}
  } catch { return {} }
}

const trayHintShown = statePath => readState(statePath).trayHintShown === true

function rememberTrayHint(statePath) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(statePath, JSON.stringify({ ...readState(statePath), trayHintShown: true }), 'utf8')
  } catch { /* shown again next time */ }
}

module.exports = { closeAction, quitQuestion, trayMenu, trayIcon, trayAvailable, confirmQuit, trayHintShown, rememberTrayHint }
