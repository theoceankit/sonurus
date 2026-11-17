const { contextBridge, ipcRenderer, webUtils } = require('electron')

// Expose only the file dialog — fetch and WebSocket work natively in the renderer.
contextBridge.exposeInMainWorld('electronAPI', {
  getPlatform:     () => ipcRenderer.invoke('get-platform'),
  getAppVersion:   () => ipcRenderer.invoke('get-app-version'),
  getTrayAvailable: () => ipcRenderer.invoke('get-tray-available'),
  openFiles:       () => ipcRenderer.invoke('open-files'),
  getFilePath:     (file) => webUtils.getPathForFile(file),
  readSettings:    () => ipcRenderer.invoke('read-settings'),
  writeSettings:   (data) => ipcRenderer.invoke('write-settings', data),
  setZoom:         (factor) => ipcRenderer.invoke('set-zoom', factor),
  setTheme:        (source) => ipcRenderer.invoke('set-theme', source),
  writeClipboard:  (text) => ipcRenderer.invoke('write-clipboard', text),
  restartBackend:  () => ipcRenderer.invoke('restart-backend'),
  showModelsFolder: () => ipcRenderer.invoke('show-models-folder'),
  setWindowDimmed: (dimmed, startedAt) => ipcRenderer.send('window-dimmed', dimmed, startedAt),
  takeWindowIntent: () => ipcRenderer.invoke('take-window-intent'),
  onWindowIntent:  (callback) => {
    const listener = () => callback()
    ipcRenderer.on('window-intent', listener)
    return () => ipcRenderer.removeListener('window-intent', listener)
  },
  getMicApps:      () => ipcRenderer.invoke('get-mic-apps'),
})
