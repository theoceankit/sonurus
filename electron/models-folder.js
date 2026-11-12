// Settings → Models: the path of the models folder opens it. Main asks the backend where its models are
// (GET /models/folder) rather than taking a path from the renderer, so the window
// cannot have main open anything but that folder.

const MODELS_FOLDER_URL = 'http://127.0.0.1:8000/models/folder'

async function backendModelsFolder() {
  const res = await fetch(MODELS_FOLDER_URL)
  if (!res.ok) throw new Error(`GET /models/folder: ${res.status}`)
  return res.json()
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
  return openPath(folder.path)
}

module.exports = { showModelsFolder }
