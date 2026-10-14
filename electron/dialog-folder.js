// The open-files dialog starts in the folder of the last picked file, also
// after a restart. Since Electron 43 a dialog without defaultPath opens
// Downloads and the OS no longer remembers the folder for us. Kept in its own
// file in userData: settings.json is rewritten whole by the renderer.

const fs = require('fs')
const path = require('path')

// The remembered folder if it still exists, else undefined (the OS decides).
function dialogFolder(statePath) {
  try {
    const { lastFolder } = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    if (typeof lastFolder === 'string' && fs.statSync(lastFolder).isDirectory()) return lastFolder
  } catch { /* none saved yet, damaged or gone */ }
  return undefined
}

function rememberDialogFolder(statePath, filePath) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(statePath, JSON.stringify({ lastFolder: path.dirname(filePath) }), 'utf8')
  } catch { /* the dialog still works, it just will not remember */ }
}

module.exports = { dialogFolder, rememberDialogFolder }
