// Loads classic (non-module) renderer scripts into an isolated VM context so
// their top-level function declarations can be unit-tested under node:test.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const RENDERER_DIR = path.join(__dirname, '..', '..', 'electron', 'renderer')

function loadRenderer(files, globals = {}) {
  const ctx = vm.createContext({ console, ...globals })
  for (const file of files) {
    const code = fs.readFileSync(path.join(RENDERER_DIR, file), 'utf8')
    vm.runInContext(code, ctx, { filename: file })
  }
  return ctx
}

module.exports = { loadRenderer }
