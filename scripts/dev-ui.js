#!/usr/bin/env node
'use strict'

// The new UI with hot reload: starts the Vite dev server, then Electron with
// --new-ui pointed at it. Arguments are passed on to Electron, e.g.
//   npm run dev:ui -- --user-data-dir=/tmp/sonorus-ui

const { spawn } = require('child_process')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const UI_DIR = path.join(ROOT, 'ui')
const VITE_BIN = path.join(UI_DIR, 'node_modules', 'vite', 'bin', 'vite.js')
const DEV_ORIGIN = 'http://localhost:5173'
const START_TIMEOUT_MS = 30000

let electronProc = null

const vite = spawn(process.execPath, [VITE_BIN], { cwd: UI_DIR, stdio: 'inherit' })

vite.on('error', err => {
  console.error(`Failed to start Vite: ${err.message}. Run: npm --prefix ui ci`)
  process.exit(1)
})
// Includes port 5173 being taken: the dev server uses strictPort.
vite.on('exit', code => {
  if (electronProc) electronProc.kill()
  process.exit(code === 0 ? 0 : 1)
})

async function waitForViteReady() {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      await fetch(DEV_ORIGIN)
      return
    } catch { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`Vite did not answer on ${DEV_ORIGIN} within ${START_TIMEOUT_MS / 1000} s`)
}

waitForViteReady().then(() => {
  electronProc = spawn(require('electron'), ['.', '--new-ui', ...process.argv.slice(2)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, SONORUS_UI_DEV_URL: DEV_ORIGIN, SONORUS_DEV_UI_ORIGIN: DEV_ORIGIN },
  })
  electronProc.on('exit', () => vite.kill())
}).catch(err => {
  console.error(err.message)
  vite.kill()
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (electronProc) electronProc.kill()
    vite.kill()
  })
}
