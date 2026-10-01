const { contextBridge, ipcRenderer, webUtils } = require('electron')

// Expose only the file dialog — fetch and WebSocket work natively in the renderer.
contextBridge.exposeInMainWorld('electronAPI', {
  getPlatform:     () => ipcRenderer.invoke('get-platform'),
  getAppVersion:   () => ipcRenderer.invoke('get-app-version'),
  openFiles:       () => ipcRenderer.invoke('open-files'),
  getFilePath:     (file) => webUtils.getPathForFile(file),
  readSettings:    () => ipcRenderer.invoke('read-settings'),
  writeSettings:   (data) => ipcRenderer.invoke('write-settings', data),
  setZoom:         (factor) => ipcRenderer.invoke('set-zoom', factor),
  writeClipboard:    (text) => ipcRenderer.invoke('write-clipboard', text),
  onSetupProgress:   (cb) => ipcRenderer.on('setup-progress', (_e, data) => cb(data)),
  startSetup:        () => ipcRenderer.send('start-setup'),
  completeSetup:     () => ipcRenderer.send('setup-complete'),
})
