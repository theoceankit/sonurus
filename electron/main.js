const { app, BrowserWindow, ipcMain, dialog, Menu, Notification, Tray, nativeImage, nativeTheme, session, clipboard, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFile } = require('child_process')
const { BackendRefusedError, backendRequest, restartBackend, startBackend, stopBackend } = require('./backend')
const { devUserDataPath } = require('./backend-identity')
const { dialogFolder, rememberDialogFolder } = require('./dialog-folder')
const { showModelsFolder } = require('./models-folder')
const { closeAction, confirmQuit, rememberTrayHint, trayAvailable, trayHintShown, trayMenu } = require('./tray')
const { watchBackendEvents } = require('./backend-events')
const { micApps, notificationsOn, promptFor, rememberMicApp, stoppedNotice } = require('./recording-prompts')
const { uiEntry } = require('./ui-entry')
const { windowChrome, themeSource, overlayDimmer } = require('./window-chrome')

// Dev mode keeps its data apart from the packaged app (electron/backend-identity.js).
// Must run before the app is ready: settings, the backend's data dir and logs follow it.
const devUserData = devUserDataPath({
  isPackaged: app.isPackaged,
  hasUserDataSwitch: app.commandLine.hasSwitch('user-data-dir'),
  appData: app.getPath('appData'),
})
if (devUserData) app.setPath('userData', devUserData)

// One app per data dir: started again while it runs, in the tray too, the running one
// opens its window instead of a second backend fighting for the port. After the
// userData path, which the lock is taken in.
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()

// macOS routes Cmd+C/V/X/A through the app's Edit menu — without it,
// paste doesn't work in any text field. Windows/Linux handle it at OS level.
if (process.platform === 'darwin') {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Edit', submenu: [
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
      { role: 'selectAll' }, { type: 'separator' },
      { role: 'undo' }, { role: 'redo' },
    ]},
  ]))
} else {
  Menu.setApplicationMenu(null)
}

let mainWin = null
let titleBarDimmer = null
let tray = null
// Whether there is a tray to stay in (electron/tray.js); found out at start-up.
let hasTray = Promise.resolve(false)
// Set once the app may quit: the question was asked, or there was nothing to ask.
let quitConfirmed = false
let quitAsked = false
// Set once the backend is up and the first window made: before that, nothing opens one.
let started = false
// The backend's queue events, heard here for the notifications of a call.
let backendEvents = null
// What a click on a notification asks the window to open, until the window takes it.
let windowIntent = null
// Notifications on screen: kept from the garbage collector, which would drop their click.
const notifications = new Set()

function createWindow() {
  const entry = uiEntry({
    isPackaged: app.isPackaged,
    devUrl: process.env.SONORUS_UI_DEV_URL,
    electronDir: __dirname,
  })
  if (entry.file && !fs.existsSync(entry.file)) {
    dialog.showErrorBox('Sonorus — UI not built', `${entry.file} does not exist.\n\nRun: npm run build:ui`)
    quitNow()
    return
  }

  mainWin = new BrowserWindow({
    width:     1200,
    height:    800,
    minWidth:  900,
    minHeight: 600,
    backgroundColor: '#FFFFFF',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    ...windowChrome(nativeTheme.shouldUseDarkColors),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  // macOS draws its own window buttons, with no strip to colour.
  const win = mainWin
  if (process.platform !== 'darwin') {
    titleBarDimmer = overlayDimmer(overlay => { if (!win.isDestroyed()) win.setTitleBarOverlay(overlay) }, {
      dark: nativeTheme.shouldUseDarkColors,
    })
  }
  // A page that loads again has no modal open, whatever the last one said.
  win.webContents.on('did-start-loading', () => titleBarDimmer?.set(false))
  win.on('close', event => {
    if (quitConfirmed) return
    // Held while the tray check settles; then destroyed for the tray, or quit as asked.
    event.preventDefault()
    void hasTray.then(available => {
      if (closeAction({ closeToTray: savedSettings().closeToTray, trayAvailable: available }) === 'quit') {
        void requestQuit()
        return
      }
      if (!win.isDestroyed()) win.destroy()
      showTrayHint()
    })
  })
  win.on('closed', () => {
    titleBarDimmer?.stop()
    titleBarDimmer = null
    if (mainWin === win) mainWin = null
  })

  if (entry.url) mainWin.loadURL(entry.url)
  else mainWin.loadFile(entry.file)

  // The page never navigates itself. Blocks e.g. a file dropped
  // outside a drop zone from replacing the app with that file.
  mainWin.webContents.on('will-navigate', e => e.preventDefault())

  // F12 opens DevTools in development only
  if (!app.isPackaged) {
    mainWin.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') mainWin.webContents.openDevTools()
    })
  }
}

const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json')
const getDialogStatePath = () => path.join(app.getPath('userData'), 'dialog-state.json')
const getAppStatePath = () => path.join(app.getPath('userData'), 'app-state.json')

const DEFAULT_SETTINGS = {
  scale: 100,
  transcribeLang: 'auto',
  transcribeModel: null,
  transcribeModelHistory: [],
  exportFormat: 'txt',
  recordingAudioSource: 'both',
  recordingMicDevice: null,
  recordingSystemDevice: null,
  hfToken: '',
  recentTranscriptIds: [],
  theme: 'system',
  closeToTray: true,
  notifications: true,
  promptStart: true,
  promptStartApps: 'any',
  promptStartSelected: [],
  promptEnd: 'suggest',
}

// The theme: 'system' follows the OS. themeSource also sets prefers-color-scheme in
// the page, which the UI follows (ui/src/platform/theme.ts).
ipcMain.handle('set-theme', (_e, source) => {
  nativeTheme.themeSource = themeSource(source)
})

// The OS or the setting changed the theme: the window behind the page takes it, and
// the strip of the window buttons moves to it as the page cross-fades.
nativeTheme.on('updated', () => {
  if (!mainWin || mainWin.isDestroyed()) return
  mainWin.setBackgroundColor(windowChrome(nativeTheme.shouldUseDarkColors).backgroundColor)
  titleBarDimmer?.setTheme(nativeTheme.shouldUseDarkColors)
})

ipcMain.handle('set-zoom', (_e, factor) => {
  if (mainWin) mainWin.webContents.setZoomFactor(factor)
})

ipcMain.handle('read-settings', () => {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'))
  } catch {
    return DEFAULT_SETTINGS
  }
})

ipcMain.handle('write-settings', (_e, data) => {
  const p = getSettingsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
})

ipcMain.handle('open-files', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    defaultPath: dialogFolder(getDialogStatePath()),
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio / Video', extensions: ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'mp4', 'mkv', 'webm'] },
    ],
  })
  if (canceled || !filePaths.length) return []
  rememberDialogFolder(getDialogStatePath(), filePaths[0])
  return filePaths
})

// A modal is open or closed: the window buttons dim with its scrim.
ipcMain.on('window-dimmed', (event, dimmed, startedAt) => {
  if (event.sender === mainWin?.webContents) titleBarDimmer?.set(Boolean(dimmed), Number(startedAt))
})

// The dialog a notification asked for, taken once by the window (on load, or when
// told an intent is waiting).
ipcMain.handle('take-window-intent', event => {
  if (event.sender !== mainWin?.webContents) return null
  const intent = windowIntent
  windowIntent = null
  return intent
})
ipcMain.handle('get-mic-apps', () => micApps(getAppStatePath()))

ipcMain.handle('get-platform', () => process.platform)
ipcMain.handle('get-tray-available', () => hasTray)
ipcMain.handle('get-app-version', () => app.getVersion())

ipcMain.handle('write-clipboard', async (_e, text) => { await clipboard.writeText(text) })

ipcMain.handle('show-models-folder', () => showModelsFolder({ openPath: p => shell.openPath(p) }))

function savedSettings() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8')) ?? {}
  } catch { return {} /* settings not yet created */ }
}

const savedHfToken = () => savedSettings().hfToken || ''

// GPU acceleration applied or removed: the renderer asks once the backend
// said it may restart (POST /gpu/restart → ready).
ipcMain.handle('restart-backend', async () => {
  await restartBackend(savedHfToken())
})

app.whenReady().then(async () => {
  if (!singleInstance) return
  hasTray = trayAvailable({
    platform: process.platform,
    run: (cmd, args) => new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 2000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
    }),
  })
  // The saved theme before the window exists, so it opens in its colours.
  nativeTheme.themeSource = themeSource(savedSettings().theme)

  // No spell checking: transcripts are in any language, and on Windows and
  // Linux Chromium downloads its dictionaries from Google at start-up. An
  // empty language list is what stops the download; macOS uses the system
  // spell checker (no download, setSpellCheckerLanguages is a no-op there).
  session.defaultSession.setSpellCheckerEnabled(false)
  session.defaultSession.setSpellCheckerLanguages([])
  // The backend records the microphone and system audio; the page needs no device.
  // Without a handler Electron would grant every request, so all are refused.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  // Start the backend first so index.html loads with a ready API.
  try {
    await startBackend(savedHfToken())
  } catch (err) {
    dialog.showErrorBox('Sonorus — backend error', err instanceof BackendRefusedError
      ? err.message
      : `Failed to start the backend:\n${err.message}\n\nCheck ${app.getPath('userData')}/sonorus.log for details.`)
    quitNow()
    return
  }

  createWindow()
  started = true
  backendEvents = watchBackendEvents({ url: 'ws://127.0.0.1:8000/ws/queue', onEvent: onBackendEvent })
  if (await hasTray) createTray()
})

// A call may have started or ended: a notification, an automatic stop or nothing,
// as the settings say (electron/recording-prompts.js).
function onBackendEvent(event) {
  if (event.type === 'mic_app_active') rememberMicApp(getAppStatePath(), event)
  const recording = backendEvents?.recording() ?? null
  const prompt = promptFor(event, { settings: savedSettings(), recording })
  if (!prompt) return
  if (prompt.kind === 'stop') {
    void backendRequest('POST', '/audio/recording/stop')
      .then(() => notify(stoppedNotice(recording.title), () => showWindow()))
      .catch(() => { /* already stopped, or the backend is gone */ })
    return
  }
  notify(prompt, () => openWithIntent(prompt.intent))
}

function notify({ title, body }, onClick) {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body })
  notifications.add(notification)
  const forget = () => notifications.delete(notification)
  notification.on('click', () => { forget(); onClick() })
  notification.on('close', forget)
  notification.on('failed', forget)
  notification.show()
}

// The window in front, told to open a dialog.
function openWithIntent(intent) {
  windowIntent = intent
  showWindow()
  // A window still loading takes the intent when its page starts.
  if (mainWin && !mainWin.isDestroyed() && !mainWin.webContents.isLoading()) mainWin.webContents.send('window-intent')
}

// The window, made again if it was closed to the tray, in front.
function showWindow() {
  if (!started || quitConfirmed) return
  if (!mainWin || mainWin.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWin.isMinimized()) mainWin.restore()
  mainWin.show()
  mainWin.focus()
}

// The app's colour icon, made small: the tray has no icon of its own yet.
function createTray() {
  const size = process.platform === 'win32' ? 32 : process.platform === 'darwin' ? 18 : 22
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: size, height: size })
  tray = new Tray(icon)
  tray.setToolTip('Sonorus')
  tray.setContextMenu(Menu.buildFromTemplate(trayMenu({ open: showWindow, quit: () => void requestQuit() })))
  // Where the tray sends clicks (Windows, KDE); on GNOME a click opens the menu.
  tray.on('click', showWindow)
}

// The first time the window closes to the tray, the system says where the app went.
function showTrayHint() {
  if (!notificationsOn(savedSettings()) || trayHintShown(getAppStatePath())) return
  rememberTrayHint(getAppStatePath())
  if (!Notification.isSupported()) return
  new Notification({ title: 'Sonorus', body: 'Sonorus is still running. Quit it from the tray icon.' }).show()
}

function quitNow() {
  quitConfirmed = true
  app.quit()
}

// Every way to quit comes here: the tray menu, Cmd+Q, the close button without a tray
// or with the setting off. A recording or a transcription is asked about first.
async function requestQuit() {
  if (quitConfirmed || quitAsked) return
  quitAsked = true
  try {
    const go = await confirmQuit({
      queue: () => backendRequest('GET', '/queue'),
      stopRecording: () => backendRequest('POST', '/audio/recording/stop'),
      ask: async question => {
        const options = {
          type: 'question',
          message: question.message,
          detail: question.detail,
          buttons: question.buttons,
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        }
        const parent = mainWin && !mainWin.isDestroyed() ? mainWin : null
        const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
        return response
      },
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    })
    if (go) quitNow()
  } finally {
    quitAsked = false
  }
}

app.on('second-instance', () => showWindow())
// macOS: a click on the Dock icon.
app.on('activate', () => showWindow())
app.on('before-quit', event => {
  if (quitConfirmed) return
  event.preventDefault()
  void requestQuit()
})
app.on('will-quit', () => {
  backendEvents?.close()
  stopBackend()
})
// Closing the window does not quit by itself: its close handler decides.
app.on('window-all-closed', () => {})
