const { contextBridge, ipcRenderer, webUtils } = require('electron')

// Expose only the file dialog — fetch and WebSocket work natively in the renderer.
contextBridge.exposeInMainWorld('electronAPI', {
  getPlatform:     () => ipcRenderer.invoke('get-platform'),
  openFile:        () => ipcRenderer.invoke('open-file'),
  getFilePath:     (file) => webUtils.getPathForFile(file),
  readSettings:    () => ipcRenderer.invoke('read-settings'),
  writeSettings:   (data) => ipcRenderer.invoke('write-settings', data),
  setZoom:         (factor) => ipcRenderer.invoke('set-zoom', factor),
  saveRecording:     (buffer, ext) => ipcRenderer.invoke('save-recording', { buffer, ext }),
  writeClipboard:    (text) => ipcRenderer.invoke('write-clipboard', text),
  onSetupProgress:   (cb) => ipcRenderer.on('setup-progress', (_e, data) => cb(data)),
})
