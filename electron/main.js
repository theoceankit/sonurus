const { app, BrowserWindow, ipcMain, dialog, Menu, session, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { startBackend, stopBackend, needsSetup } = require('./backend')

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

function createWindow(setupMode = false) {
  mainWin = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#FFFFFF',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const page = setupMode ? 'setup.html' : 'index.html'
  mainWin.loadFile(path.join(__dirname, 'renderer', page))

  // F12 opens DevTools in development only
  if (!app.isPackaged) {
    mainWin.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') mainWin.webContents.openDevTools()
    })
  }
}

const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json')

const DEFAULT_SETTINGS = {
  scale: 100,
  transcribeLang: 'auto',
  transcribeModel: 'small',
  exportFormat: 'txt',
  recordingMicDevice: null,
  recordingSystemDevice: null,
  recordingUseMic: true,
  hfToken: '',
}

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

ipcMain.handle('open-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Audio / Video', extensions: ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'mp4', 'mkv', 'webm'] },
    ],
  })
  return canceled ? null : filePaths[0]
})

ipcMain.handle('write-clipboard', (_e, text) => { clipboard.writeText(text) })

ipcMain.handle('save-recording', (_e, { buffer, ext }) => {
  const name = `sonorus-rec-${crypto.randomUUID()}.${ext}`
  const dest = path.join(os.tmpdir(), name)
  fs.writeFileSync(dest, Buffer.from(buffer))
  return dest
})

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })

  let hfToken = ''
  try {
    const saved = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'))
    hfToken = saved.hfToken || ''
  } catch { /* settings not yet created */ }

  const setupMode = needsSetup()

  // Setup mode: open window first (to show progress screen), then start backend.
  // Normal mode: start backend first so index.html loads with a ready API.
  if (setupMode) createWindow(true)

  const onProgress = data => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('setup-progress', data)
  }

  try {
    await startBackend(hfToken, setupMode ? onProgress : null)
  } catch (err) {
    dialog.showErrorBox('Sonorus — backend error',
      `Failed to start the backend:\n${err.message}\n\nCheck ${app.getPath('userData')}/sonorus.log for details.`)
    app.quit()
    return
  }

  if (setupMode) {
    mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  } else {
    createWindow(false)
  }
})

app.on('will-quit', () => stopBackend())
app.on('window-all-closed', () => app.quit())
