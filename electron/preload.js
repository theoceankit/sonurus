const { contextBridge, ipcRenderer, webUtils } = require('electron')

// Expose only the file dialog — fetch and WebSocket work natively in the renderer.
contextBridge.exposeInMainWorld('electronAPI', {
  openFile:      () => ipcRenderer.invoke('open-file'),
  getFilePath:   (file) => webUtils.getPathForFile(file),
  readSettings:  () => ipcRenderer.invoke('read-settings'),
  writeSettings: (data) => ipcRenderer.invoke('write-settings', data),
  setZoom:       (factor) => ipcRenderer.invoke('set-zoom', factor),
})
