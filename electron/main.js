const { app, BrowserWindow, ipcMain, dialog, Menu, session, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

Menu.setApplicationMenu(null)

let mainWin = null

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#FFFFFF',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // F12 opens DevTools
  mainWin.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') mainWin.webContents.openDevTools()
  })
}

const SETTINGS_PATH = path.join(__dirname, '..', 'settings.json')

const DEFAULT_SETTINGS = {
  scale: 100,
  transcribeLang: 'auto',
  transcribeModel: 'small',
  exportFormat: 'txt',
  recordingMicDevice: null,
  recordingSystemDevice: null,
  recordingUseMic: true,
}

ipcMain.handle('set-zoom', (_e, factor) => {
  if (mainWin) mainWin.webContents.setZoomFactor(factor)
})

ipcMain.handle('read-settings', () => {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))
  } catch {
    return DEFAULT_SETTINGS
  }
})

ipcMain.handle('write-settings', (_e, data) => {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf8')
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
  const name = `whisper-rec-${crypto.randomUUID()}.${ext}`
  const dest = path.join(os.tmpdir(), name)
  fs.writeFileSync(dest, Buffer.from(buffer))
  return dest
})

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })
  createWindow()
})
app.on('window-all-closed', () => app.quit())
