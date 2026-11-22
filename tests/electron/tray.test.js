// The window's close button keeps Sonorus running in the tray; the app quits
// from the tray menu, asking first while a recording or a transcription runs.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const {
  closeAction, quitQuestion, trayMenu, trayAvailable, confirmQuit, trayHintShown, rememberTrayHint, trayIcon,
} = require(path.join(ROOT, 'electron', 'tray.js'))

const snapshot = (over = {}) => ({ recording: null, running_job_id: null, ...over })
const live = { phase: 'live', title: 'Call', started_at: 1, sources: ['mic'] }

test('close keeps the app in the tray when the setting is on and there is a tray', () => {
  assert.equal(closeAction({ closeToTray: true, trayAvailable: true }), 'destroy')
})

test('close quits without a tray or with the setting off', () => {
  assert.equal(closeAction({ closeToTray: true, trayAvailable: false }), 'quit')
  assert.equal(closeAction({ closeToTray: false, trayAvailable: true }), 'quit')
})

test('the setting is on unless it says false', () => {
  assert.equal(closeAction({ closeToTray: undefined, trayAvailable: true }), 'destroy')
})

test('nothing running: no question', () => {
  assert.equal(quitQuestion(snapshot()), null)
  assert.equal(quitQuestion(null), null)
})

test('a recording asks to stop it', () => {
  const q = quitQuestion(snapshot({ recording: live }))
  assert.equal(q.kind, 'recording')
  assert.equal(q.message, 'Recording is in progress. Stop it and quit?')
  assert.deepEqual(q.buttons, ['Stop and quit', 'Cancel'])
})

test('a recording that is starting or stopping asks too', () => {
  for (const phase of ['starting', 'stopping']) {
    assert.equal(quitQuestion(snapshot({ recording: { ...live, phase } })).kind, 'recording')
  }
})

test('a running transcription asks whether to interrupt it', () => {
  const q = quitQuestion(snapshot({ running_job_id: 'j1' }))
  assert.equal(q.kind, 'transcription')
  assert.equal(q.message, 'Transcription will be interrupted. Quit?')
  assert.deepEqual(q.buttons, ['Quit', 'Cancel'])
})

test('a recording and a transcription: the recording question says both', () => {
  const q = quitQuestion(snapshot({ recording: live, running_job_id: 'j1' }))
  assert.equal(q.kind, 'recording')
  assert.match(q.detail, /transcription/i)
})

test('the tray menu: Open, a separator, Quit', () => {
  const calls = []
  const menu = trayMenu({ open: () => calls.push('open'), quit: () => calls.push('quit') })
  assert.deepEqual(menu.map(i => i.label ?? i.type), ['Open Sonorus', 'separator', 'Quit Sonorus'])
  menu[0].click()
  menu[2].click()
  assert.deepEqual(calls, ['open', 'quit'])
})

test('Windows and macOS always have a tray', async () => {
  const run = async () => { throw new Error('not called') }
  assert.equal(await trayAvailable({ platform: 'win32', run }), true)
  assert.equal(await trayAvailable({ platform: 'darwin', run }), true)
})

test('Linux: a tray when StatusNotifierWatcher has an owner', async () => {
  let asked
  const run = async (cmd, args) => { asked = [cmd, ...args]; return '(true,)\n' }
  assert.equal(await trayAvailable({ platform: 'linux', run }), true)
  assert.equal(asked[0], 'gdbus')
  assert.ok(asked.includes('org.kde.StatusNotifierWatcher'))
})

test('Linux: no tray without an owner, without gdbus or on an error', async () => {
  assert.equal(await trayAvailable({ platform: 'linux', run: async () => '(false,)\n' }), false)
  const missing = Object.assign(new Error('spawn gdbus ENOENT'), { code: 'ENOENT' })
  assert.equal(await trayAvailable({ platform: 'linux', run: async () => { throw missing } }), false)
  assert.equal(await trayAvailable({ platform: 'linux', run: async () => 'garbage' }), false)
})

function quitDeps(snapshots, answer) {
  const calls = []
  let i = 0
  return {
    calls,
    deps: {
      queue: async () => { calls.push('queue'); return snapshots[Math.min(i++, snapshots.length - 1)] },
      ask: async q => { calls.push(`ask:${q.kind}`); return answer },
      stopRecording: async () => { calls.push('stop') },
      sleep: async () => {},
      timeoutMs: 1000,
      now: (() => { let t = 0; return () => (t += 10) })(),
    },
  }
}

test('quit with nothing running: no question', async () => {
  const { calls, deps } = quitDeps([snapshot()], 0)
  assert.equal(await confirmQuit(deps), true)
  assert.deepEqual(calls, ['queue'])
})

test('quit while the backend does not answer: quits', async () => {
  const { deps } = quitDeps([snapshot()], 0)
  deps.queue = async () => { throw new Error('ECONNREFUSED') }
  assert.equal(await confirmQuit(deps), true)
})

test('Cancel keeps everything as it was', async () => {
  const { calls, deps } = quitDeps([snapshot({ recording: live })], 1)
  assert.equal(await confirmQuit(deps), false)
  assert.deepEqual(calls, ['queue', 'ask:recording'])
})

test('Stop and quit stops the recording and waits until it is saved', async () => {
  const stopping = snapshot({ recording: { ...live, phase: 'stopping' } })
  const { calls, deps } = quitDeps([snapshot({ recording: live }), stopping, stopping, snapshot()], 0)
  assert.equal(await confirmQuit(deps), true)
  assert.deepEqual(calls, ['queue', 'ask:recording', 'stop', 'queue', 'queue', 'queue'])
})

test('a recording that never finishes saving does not keep the app from quitting', async () => {
  const stopping = snapshot({ recording: { ...live, phase: 'stopping' } })
  const { deps } = quitDeps([snapshot({ recording: live }), stopping], 0)
  assert.equal(await confirmQuit(deps), true)
})

test('a transcription: Quit quits, the recording is not touched', async () => {
  const { calls, deps } = quitDeps([snapshot({ running_job_id: 'j1' })], 0)
  assert.equal(await confirmQuit(deps), true)
  assert.deepEqual(calls, ['queue', 'ask:transcription'])
})

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-tray-'))
  return { state: path.join(dir, 'user-data', 'app-state.json'), done: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('the hint of the first close is shown once, also across restarts', () => {
  const t = tmp()
  try {
    assert.equal(trayHintShown(t.state), false)
    rememberTrayHint(t.state)
    assert.equal(trayHintShown(t.state), true)
  } finally { t.done() }
})

test('the hint keeps what else the state file holds', () => {
  const t = tmp()
  try {
    fs.mkdirSync(path.dirname(t.state), { recursive: true })
    fs.writeFileSync(t.state, JSON.stringify({ other: 1 }))
    rememberTrayHint(t.state)
    assert.deepEqual(JSON.parse(fs.readFileSync(t.state, 'utf8')), { other: 1, trayHintShown: true })
  } finally { t.done() }
})

test('a damaged state file counts as not shown', () => {
  const t = tmp()
  try {
    fs.mkdirSync(path.dirname(t.state), { recursive: true })
    fs.writeFileSync(t.state, '{')
    assert.equal(trayHintShown(t.state), false)
  } finally { t.done() }
})

test('macOS takes the template image whatever the theme: the menu bar tints it', () => {
  assert.equal(trayIcon('darwin', true), 'trayTemplate.png')
  assert.equal(trayIcon('darwin', false), 'trayTemplate.png')
})

test('Windows takes the quill that shows on the taskbar of the system theme', () => {
  assert.equal(trayIcon('win32', true), 'trayOnDark.ico')
  assert.equal(trayIcon('win32', false), 'trayOnLight.ico')
})

test('Linux takes the outlined quill whatever the theme: the colour of the panel is unknown', () => {
  assert.equal(trayIcon('linux', true), 'trayLinux.png')
  assert.equal(trayIcon('linux', false), 'trayLinux.png')
})

test('every tray icon file is in electron/assets', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    for (const dark of [true, false]) {
      assert.ok(fs.existsSync(path.join(ROOT, 'electron', 'assets', trayIcon(platform, dark))), `${platform} ${dark}`)
    }
  }
})

const main = () => fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')

test('main.js colours the tray by the taskbar, not by a theme of nativeTheme', () => {
  assert.match(main(), /trayIcon\(process\.platform, taskbar\?\.dark\(\)/)
  assert.doesNotMatch(main(), /shouldUseDarkColorsForSystemIntegratedUI/)
})

test('main.js reads the taskbar before it makes the tray', () => {
  const ready = main().slice(main().indexOf('app.whenReady()'))
  const read = ready.indexOf('await watchTaskbar()')
  assert.ok(read > 0, 'the taskbar is not read at start-up')
  assert.ok(read < ready.indexOf('createTray()'), 'the tray would start in a guessed colour')
})

test('main.js hears a change of the Windows mode alone, with the window closed too', () => {
  const watch = main().slice(main().indexOf('function watchTaskbar()'))
  const body = watch.slice(0, watch.indexOf('\n}'))
  assert.match(body, /new BaseWindow\(\{ show: false \}\)/)
  assert.match(body, /hookWindowMessage\(WM_SETTINGCHANGE/)
})

test('main.js reads the taskbar again before the theme handler leaves for a missing window', () => {
  const handler = main().slice(main().indexOf("nativeTheme.on('updated'"))
  const update = handler.indexOf('taskbar?.changed()')
  assert.ok(update > 0, 'the handler does not read the taskbar')
  assert.ok(update < handler.indexOf('if (!mainWin'), 'a window closed to the tray would keep the old icon')
})

test('main.js runs commands without a console window flashing on Windows', () => {
  assert.match(main(), /execFile\(cmd, args, \{ timeout: 2000, windowsHide: true \}/)
})
