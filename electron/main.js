const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path')
const fs = require('fs')

Menu.setApplicationMenu(null)

let mainWin = null

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#EDE9F4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

const SETTINGS_PATH = path.join(__dirname, '..', 'settings.json')

const DEFAULT_SETTINGS = {
  scale: 100,
  transcribeLang: 'auto',
  transcribeModel: 'small',
  exportFormat: 'txt',
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

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
