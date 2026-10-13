const { app, BrowserWindow, ipcMain, dialog, Menu, session, clipboard, desktopCapturer } = require('electron')
const path = require('path')
const fs = require('fs')
const { startBackend, stopBackend } = require('./backend')

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

function createWindow() {
  mainWin = new BrowserWindow({
    width:     1200,
    height:    800,
    minWidth:  900,
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

  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'))

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

const DEFAULT_SETTINGS = {
  scale: 100,
  transcribeLang: 'auto',
  transcribeModel: null,
  transcribeModelHistory: [],
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

ipcMain.handle('open-files', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio / Video', extensions: ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'mp4', 'mkv', 'webm'] },
    ],
  })
  return canceled ? [] : filePaths
})

ipcMain.handle('get-platform', () => process.platform)
ipcMain.handle('get-app-version', () => app.getVersion())

ipcMain.handle('write-clipboard', (_e, text) => { clipboard.writeText(text) })

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture')
  })

  // Windows: intercept getDisplayMedia and provide system audio via WASAPI loopback
  // (no picker — fully automatic). macOS and Linux do not support system audio
  // via getDisplayMedia in Electron — Chromium returns video-only (0 audio tracks).
  if (process.platform === 'win32') {
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
        callback({ video: sources[0], audio: 'loopback' })
      }).catch(() => callback({}))
    }, { useSystemPicker: false })
  }

  let hfToken = ''
  try {
    const saved = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'))
    hfToken = saved.hfToken || ''
  } catch { /* settings not yet created */ }

  // Start the backend first so index.html loads with a ready API.
  try {
    await startBackend(hfToken)
  } catch (err) {
    dialog.showErrorBox('Sonorus — backend error',
      `Failed to start the backend:\n${err.message}\n\nCheck ${app.getPath('userData')}/sonorus.log for details.`)
    app.quit()
    return
  }

  createWindow()
})

app.on('will-quit', () => stopBackend())
app.on('window-all-closed', () => app.quit())
