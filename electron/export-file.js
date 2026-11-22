// Saves an export of a transcript. The window hands over the format picked in its
// menu and the text, never a path: the file is the one picked in the save dialog.
// The dialog offers that format only, as Electron does not report a file type
// changed in it.

const { randomBytes } = require('crypto')
const fs = require('fs')
const path = require('path')
const { dialogFolder, rememberDialogFolder } = require('./dialog-folder')

const EXPORT_FORMATS = [
  { id: 'txt', name: 'Plain text' },
  { id: 'md', name: 'Markdown' },
  { id: 'json', name: 'JSON' },
]
const NAME_MAX_LENGTH = 120

// The title as a file name on every system.
function exportFileName(title, format) {
  const name = String(title ?? '')
    .replace(/[/\\:*?"<>|\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, NAME_MAX_LENGTH)
    .replace(/^[\s.]+|[\s.]+$/g, '')
  return `${name || 'Transcript'}.${format}`
}

// The format was picked before the dialog: a name that does not end in it gets its
// extension, so a file never holds something other than its name says.
function exportTarget(chosen, format) {
  if (chosen.toLowerCase().endsWith(`.${format}`)) return { filePath: chosen, extended: false }
  return { filePath: `${chosen}.${format}`, extended: true }
}

// Written next to the file and renamed over it: a write that fails halfway, as on a
// full disk, leaves what was there. As a write in place would, it goes through a link,
// keeps the permissions and refuses a file that may not be written.
async function replaceFile(chosen, text) {
  let filePath = chosen
  let mode
  try {
    filePath = await fs.promises.realpath(chosen)
    await fs.promises.access(filePath, fs.constants.W_OK)
    mode = (await fs.promises.stat(filePath)).mode & 0o777
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const temporary = path.join(path.dirname(filePath), `.sonorus-export-${randomBytes(6).toString('hex')}.tmp`)
  try {
    await fs.promises.writeFile(temporary, text, { encoding: 'utf8', mode, flush: true })
    // Past the umask. A file system without permissions (FAT) may refuse it.
    if (mode !== undefined) await fs.promises.chmod(temporary, mode).catch(() => {})
    await fs.promises.rename(temporary, filePath)
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => {})
    // The file picked is the one the user knows.
    error.message = error.message.replaceAll(temporary, filePath)
    throw error
  }
}

// The dialog asks before replacing the name it was given. A name extended here is
// another one, so asking about it is left to confirmReplace.
async function saveExport(request, { showSaveDialog, confirmReplace, statePath }) {
  const { title, format, text } = request ?? {}
  const known = EXPORT_FORMATS.find(({ id }) => id === format)
  if (!known || typeof text !== 'string') return { status: 'failed', message: 'Nothing to write' }
  const name = exportFileName(title, format)
  const folder = dialogFolder(statePath)
  const { canceled, filePath: chosen } = await showSaveDialog({
    defaultPath: folder ? path.join(folder, name) : name,
    filters: [{ name: known.name, extensions: [format] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  })
  if (canceled || !chosen) return { status: 'canceled' }

  const target = exportTarget(chosen, format)
  try {
    if (target.extended && fs.existsSync(target.filePath) && !(await confirmReplace(target.filePath))) return { status: 'canceled' }
    await replaceFile(target.filePath, text)
  } catch (error) {
    return { status: 'failed', message: error.message }
  }
  rememberDialogFolder(statePath, target.filePath)
  return { status: 'saved' }
}

module.exports = { EXPORT_FORMATS, exportFileName, exportTarget, saveExport }
