// Settings → Models: the path of the models folder opens it. Main asks the backend where its models are
// (GET /models/folder) rather than taking a path from the renderer, so the window
// cannot have main open anything but that folder. Main checks the answer too:
// shell.openPath runs a file with its default application, so it opens only an
// existing folder named .models, whatever holds the port.

const fs = require('fs')
const path = require('path')

const MODELS_FOLDER_URL = 'http://127.0.0.1:8000/models/folder'
const MODELS_FOLDER_NAME = '.models'

async function backendModelsFolder() {
  const res = await fetch(MODELS_FOLDER_URL)
  if (!res.ok) throw new Error(`GET /models/folder: ${res.status}`)
  return res.json()
}

// An absolute path to an existing folder named .models, or null.
function modelsFolderPath(p) {
  if (!path.isAbsolute(p)) return null
  const resolved = path.resolve(p)
  if (path.basename(resolved) !== MODELS_FOLDER_NAME) return null
  return fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory() ? resolved : null
}

// → '' once the file manager opened it, else why it did not (as shell.openPath).
async function showModelsFolder({ getFolder = backendModelsFolder, openPath }) {
  let folder
  try {
    folder = await getFolder()
  } catch {
    return 'The transcription service does not answer.'
  }
  if (!folder || typeof folder.path !== 'string' || !folder.path) return 'The transcription service did not tell where the models are.'
  if (!folder.exists) return 'There is no models folder yet: it appears with the first download.'
  const models = modelsFolderPath(folder.path)
  if (!models) return 'The transcription service named a path that is not a models folder.'
  return openPath(models)
}

module.exports = { showModelsFolder }
