// Saves an export of a transcript. The window hands over the text of every format
// and never a path: the file is the one the user picked in the save dialog, and
// its extension says which format goes into it. Electron does not report the file
// type picked in the dialog.

const fs = require('fs')
const path = require('path')
const { dialogFolder, rememberDialogFolder } = require('./dialog-folder')

const EXPORT_FORMATS = [
  { id: 'txt', name: 'Plain text' },
  { id: 'md', name: 'Markdown' },
  { id: 'json', name: 'JSON' },
]
const isFormat = id => EXPORT_FORMATS.some(format => format.id === id)
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

// A name without a known extension gets the default one: "v1.2 sync" has none.
function exportTarget(chosen, fallback) {
  const extension = path.extname(chosen).slice(1)
  const format = extension.toLowerCase()
  if (isFormat(format)) return { filePath: chosen, format, extended: false }
  return { filePath: `${chosen}.${fallback}`, format: fallback, extended: true }
}

// The default format first: the dialog starts on it.
const dialogFilters = format => [...EXPORT_FORMATS]
  .sort((a, b) => (b.id === format) - (a.id === format))
  .map(({ id, name }) => ({ name, extensions: [id] }))

// The dialog asks before replacing the name it was given. A name extended here is
// another one, so asking about it is left to confirmReplace.
async function saveExport(request, { showSaveDialog, confirmReplace, statePath }) {
  const { title, format: wanted, contents } = request ?? {}
  const format = isFormat(wanted) ? wanted : 'txt'
  const name = exportFileName(title, format)
  const folder = dialogFolder(statePath)
  const { canceled, filePath: chosen } = await showSaveDialog({
    defaultPath: folder ? path.join(folder, name) : name,
    filters: dialogFilters(format),
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  })
  if (canceled || !chosen) return { status: 'canceled' }

  const target = exportTarget(chosen, format)
  const text = contents?.[target.format]
  if (typeof text !== 'string') return { status: 'failed', message: 'Nothing to write' }
  try {
    if (target.extended && fs.existsSync(target.filePath) && !(await confirmReplace(target.filePath))) return { status: 'canceled' }
    await fs.promises.writeFile(target.filePath, text, 'utf8')
  } catch (error) {
    return { status: 'failed', message: error.message }
  }
  rememberDialogFolder(statePath, target.filePath)
  return { status: 'saved' }
}

module.exports = { EXPORT_FORMATS, exportFileName, exportTarget, saveExport }
