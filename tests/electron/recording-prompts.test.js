// The backend says a call may have started or ended (mic_app_active, call_ended);
// the main process turns that into a notification, an automatic stop or nothing,
// by the user's notification settings.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const {
  promptFor, stopOutcome, stopTimedOut, notificationsOn, micApps, rememberMicApp,
} = require(path.join(ROOT, 'electron', 'recording-prompts.js'))
const { watchBackendEvents } = require(path.join(ROOT, 'electron', 'backend-events.js'))

const DEFAULTS = {
  notifications: true, promptStart: true, promptStartApps: 'any', promptStartSelected: [], promptEnd: 'suggest',
}
const started = { type: 'mic_app_active', app_id: 'discord', name: 'Discord' }
const live = { phase: 'live', title: 'Call', started_at: 1, sources: ['mic'] }

test('an app holding the microphone suggests a recording that opens New recording', () => {
  assert.deepEqual(promptFor(started, { settings: DEFAULTS, recording: null }), {
    kind: 'notify',
    title: 'Looks like a call started in Discord',
    body: 'Click to start recording.',
    intent: { dialog: 'new-recording', app: 'Discord' },
  })
})

test('an app the system does not name gives a notice without a name', () => {
  const prompt = promptFor({ ...started, name: null }, { settings: DEFAULTS, recording: null })
  assert.equal(prompt.title, 'Looks like a call started')
  assert.deepEqual(prompt.intent, { dialog: 'new-recording', app: null })
})

test('saved settings missing the new keys take the defaults', () => {
  assert.equal(promptFor(started, { settings: {}, recording: null }).kind, 'notify')
  assert.equal(promptFor({ type: 'call_ended', reason: 'silence' }, { settings: {}, recording: live }).kind, 'notify')
})

test('no start suggestion while recording, with suggestions off, or with all notifications off', () => {
  assert.equal(promptFor(started, { settings: DEFAULTS, recording: live }), null)
  assert.equal(promptFor(started, { settings: { ...DEFAULTS, promptStart: false }, recording: null }), null)
  assert.equal(promptFor(started, { settings: { ...DEFAULTS, notifications: false }, recording: null }), null)
})

test('with selected apps only those suggest a recording', () => {
  const settings = { ...DEFAULTS, promptStartApps: 'selected', promptStartSelected: ['zoom'] }
  assert.equal(promptFor(started, { settings, recording: null }), null)
  assert.equal(promptFor({ ...started, app_id: 'zoom', name: 'Zoom' }, { settings, recording: null }).kind, 'notify')
})

test('the end of a call suggests stopping, which opens the stop dialog', () => {
  assert.deepEqual(promptFor({ type: 'call_ended', reason: 'mic_released' }, { settings: DEFAULTS, recording: live }), {
    kind: 'notify',
    title: 'Looks like the call ended',
    body: 'Click to stop recording.',
    intent: { dialog: 'stop-recording' },
  })
  const silence = promptFor({ type: 'call_ended', reason: 'silence' }, { settings: DEFAULTS, recording: live })
  assert.equal(silence.body, 'Nothing was heard for 5 minutes. Click to stop recording.')
})

test('the end of a call stops the recording when set to, and says nothing when off', () => {
  const ended = { type: 'call_ended', reason: 'mic_released' }
  assert.deepEqual(promptFor(ended, { settings: { ...DEFAULTS, promptEnd: 'auto' }, recording: live }), { kind: 'stop' })
  assert.equal(promptFor(ended, { settings: { ...DEFAULTS, promptEnd: 'off' }, recording: live }), null)
})

test('the end of a call does nothing once the recording is no longer live', () => {
  const ended = { type: 'call_ended', reason: 'mic_released' }
  assert.equal(promptFor(ended, { settings: DEFAULTS, recording: null }), null)
  assert.equal(promptFor(ended, { settings: DEFAULTS, recording: { ...live, phase: 'stopping' } }), null)
})

test('with all notifications off the recording is not stopped either', () => {
  const ended = { type: 'call_ended', reason: 'silence' }
  assert.equal(promptFor(ended, { settings: { ...DEFAULTS, promptEnd: 'auto', notifications: false }, recording: live }), null)
})

test('other events are not prompts', () => {
  assert.equal(promptFor({ type: 'job_done', job_id: 'x' }, { settings: DEFAULTS, recording: null }), null)
})

test('an automatic stop is told as saved only once the recording left the snapshot', () => {
  assert.equal(stopOutcome({ type: 'snapshot', recording: { ...live, phase: 'stopping' } }, 'Call'), null)
  assert.deepEqual(stopOutcome({ type: 'snapshot', recording: null }, 'Call'), { title: 'Recording stopped and saved', body: 'Call' })
})

test('an automatic stop that could not save says why', () => {
  assert.deepEqual(stopOutcome({ type: 'recording_failed', title: 'Call', error: 'No audio was captured.' }, 'Call'), {
    title: 'Could not save the recording',
    body: 'Call: No audio was captured.',
  })
})

test('other events say nothing of the stop', () => {
  assert.equal(stopOutcome({ type: 'job_done', job_id: 'x' }, 'Call'), null)
})

test('an automatic stop with no word from the backend does not claim it was saved', () => {
  assert.deepEqual(stopTimedOut('Call'), { title: 'Recording stopped', body: 'Call. Open Sonorus to see whether it was saved.' })
})

test('all notifications are on unless turned off, the tray notice included', () => {
  assert.equal(notificationsOn({}), true)
  assert.equal(notificationsOn({ notifications: false }), false)
})

test('the apps that held a microphone are remembered once each, with their latest name', () => {
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-mic-apps-')), 'app-state.json')
  fs.writeFileSync(statePath, JSON.stringify({ trayHintShown: true }))
  assert.deepEqual(micApps(statePath), [])
  rememberMicApp(statePath, { app_id: 'discord', name: 'Discord' })
  rememberMicApp(statePath, { app_id: 'firefox', name: 'Firefox' })
  rememberMicApp(statePath, { app_id: 'discord', name: 'Discord Canary' })
  assert.deepEqual(micApps(statePath), [{ id: 'discord', name: 'Discord Canary' }, { id: 'firefox', name: 'Firefox' }])
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).trayHintShown, true)
})

test('an app without a name is remembered by its id', () => {
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-mic-apps-')), 'app-state.json')
  rememberMicApp(statePath, { app_id: 'microphone', name: null })
  assert.deepEqual(micApps(statePath), [{ id: 'microphone', name: 'microphone' }])
})

// ── The events of the backend ────────────────────────────────────────────────

class FakeSocket {
  static all = []
  constructor(url) {
    this.url = url
    FakeSocket.all.push(this)
  }
  close() { this.onclose?.() }
  send(data) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

const timers = () => {
  const pending = []
  return { pending, set: (fn) => { pending.push(fn); return pending.length }, clear: () => {} }
}

test('the main process hears the backend events and keeps the live recording', () => {
  FakeSocket.all = []
  const heard = []
  const t = timers()
  const events = watchBackendEvents({ url: 'ws://127.0.0.1:8000/ws/queue', WebSocketImpl: FakeSocket, onEvent: e => heard.push(e), setTimer: t.set, clearTimer: t.clear })
  const [socket] = FakeSocket.all
  assert.equal(socket.url, 'ws://127.0.0.1:8000/ws/queue')
  socket.send({ type: 'snapshot', recording: live, jobs: [] })
  socket.send({ type: 'heartbeat' })
  socket.send({ type: 'call_ended', reason: 'silence' })
  assert.deepEqual(heard, [{ type: 'call_ended', reason: 'silence' }])
  assert.deepEqual(events.recording(), live)
  socket.send({ type: 'snapshot', recording: null, jobs: [] })
  assert.equal(events.recording(), null)
  events.close()
})

test('a lost connection is made again, and none after close', () => {
  FakeSocket.all = []
  const t = timers()
  const events = watchBackendEvents({ url: 'ws://x', WebSocketImpl: FakeSocket, onEvent: () => {}, setTimer: t.set, clearTimer: t.clear })
  FakeSocket.all[0].close()
  assert.equal(t.pending.length, 1)
  t.pending.shift()()
  assert.equal(FakeSocket.all.length, 2)
  events.close()
  assert.equal(t.pending.length, 0)
  assert.equal(FakeSocket.all.length, 2)
})

test('snapshots go to their own listener', () => {
  FakeSocket.all = []
  const snapshots = []
  const events = watchBackendEvents({ url: 'ws://x', WebSocketImpl: FakeSocket, onEvent: () => {}, onSnapshot: s => snapshots.push(s), setTimer: () => 0, clearTimer: () => {} })
  FakeSocket.all[0].send({ type: 'snapshot', recording: null, jobs: [] })
  assert.deepEqual(snapshots, [{ type: 'snapshot', recording: null, jobs: [] }])
  events.close()
})

test('a message that is not JSON is skipped', () => {
  FakeSocket.all = []
  const heard = []
  const events = watchBackendEvents({ url: 'ws://x', WebSocketImpl: FakeSocket, onEvent: e => heard.push(e), setTimer: () => 0, clearTimer: () => {} })
  FakeSocket.all[0].onmessage({ data: 'nope' })
  assert.deepEqual(heard, [])
  events.close()
})

// ── Wired in the main process ────────────────────────────────────────────────

const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')

test('the main process listens to its own backend only', () => {
  assert.match(main, /watchBackendEvents\(\{ url: 'ws:\/\/127\.0\.0\.1:8000\/ws\/queue'/)
})

test('the tray notice is a notification too: all notifications off stops it', () => {
  const hint = main.slice(main.indexOf('function showTrayHint()'))
  assert.match(hint.slice(0, hint.indexOf('\n}')), /notificationsOn\(savedSettings\(\)\)/)
})

test('only the window takes the intent of a notification', () => {
  const handler = main.slice(main.indexOf("ipcMain.handle('take-window-intent'"))
  assert.match(handler.slice(0, handler.indexOf('\n})')), /event\.sender !== mainWin\?\.webContents/)
})

// Windows shows a toast only for an app with an AppUserModelID: the installer's
// shortcut carries build.appId, a dev run has no shortcut and goes by its exe.
test('Windows notifications go out under the app id of the build', () => {
  const { appUserModelId } = require(path.join(ROOT, 'electron', 'recording-prompts.js'))
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal(appUserModelId({ isPackaged: true, execPath: 'C:\\Sonorus\\Sonorus.exe' }), pkg.build.appId)
  assert.equal(appUserModelId({ isPackaged: false, execPath: 'C:\\dev\\electron.exe' }), 'C:\\dev\\electron.exe')
})

test('the main process sets the AppUserModelID on Windows before any notification', () => {
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')
  const set = src.indexOf('app.setAppUserModelId(appUserModelId(')
  assert.ok(set > 0, 'main.js does not set the AppUserModelID')
  assert.ok(src.lastIndexOf("process.platform === 'win32'", set) > 0)
  const first = src.indexOf('createNotifier(')
  assert.ok(first > 0, 'main.js makes no notifier')
  assert.ok(set < first, 'set after the notifier')
})
