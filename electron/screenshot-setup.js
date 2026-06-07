// DEV-ONLY utility — never packaged (electron-builder ignores files not in package.json main/files)
// Run manually: SCREEN=welcome npx electron electron/screenshot-setup.js
// WARNING: uses contextIsolation:false/nodeIntegration:true for executeJavaScript access —
//          must NOT be used as an entry point in production builds.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const SCREEN = process.env.SCREEN || 'welcome'  // welcome | install | permissions

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1000, height: 680,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: true },
  })
  await win.loadFile(path.join(__dirname, 'renderer', 'setup.html'))
  await new Promise(r => setTimeout(r, 600))

  if (SCREEN === 'install') {
    await win.webContents.executeJavaScript(`
      document.getElementById('screen-welcome').classList.add('hidden');
      const si = document.getElementById('screen-installing');
      si.style.cssText = 'display:flex; flex:1; flex-direction:column; gap:16px; min-height:0; width:100%';
      // simulate install phase
      if (typeof setStep === 'function') setStep(1);
      if (typeof setPhase === 'function') setPhase('downloading');
      // fake 45%
      if (typeof setProgressTarget === 'function') setProgressTarget(40);
    `)
    await new Promise(r => setTimeout(r, 400))
  }

  if (SCREEN === 'permissions') {
    await win.webContents.executeJavaScript(`
      document.getElementById('screen-welcome').classList.add('hidden');
      const sp = document.getElementById('screen-permissions');
      sp.style.cssText = 'display:flex; flex:1; flex-direction:column; min-height:0; width:100%';
      if (typeof setStep === 'function') setStep(2);
    `)
    await new Promise(r => setTimeout(r, 400))
  }

  const img = await win.webContents.capturePage()
  const out = path.join(__dirname, '..', `setup-${SCREEN}.png`)
  fs.writeFileSync(out, img.toPNG())
  console.log('Screenshot saved:', out)
  app.quit()
})
