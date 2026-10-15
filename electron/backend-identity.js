// Dev mode and the packaged app never see each other's data. Both would get
// the same userData (Electron names it after `name` in package.json, and a
// different case is the same folder on macOS and Windows), so dev mode uses
// its own folder. And since both run the backend on port 8000, a backend that
// already answers there is reused only if it is ours (GET /health reports its
// data dir and whether the packaged app started it).
const path = require('path')

const DEV_DATA_DIR_NAME = 'sonorus-dev'

// userData for this run, or null to keep Electron's default. An explicit
// --user-data-dir always wins (isolated checks of a build or of the UI).
function devUserDataPath({ isPackaged, hasUserDataSwitch, appData }) {
  if (isPackaged || hasUserDataSwitch) return null
  return path.join(appData, DEV_DATA_DIR_NAME)
}

function normalizeDir(dir, platform) {
  const resolved = path.resolve(dir)
  return platform === 'win32' || platform === 'darwin' ? resolved.toLowerCase() : resolved
}

// Does the backend that answered GET /health serve this data dir?
function servesDataDir(health, dataDir, platform) {
  if (!health || typeof health.data_dir !== 'string') return false
  return normalizeDir(health.data_dir, platform) === normalizeDir(dataDir, platform)
}

// What to do with what answers on port 8000. health: the parsed GET /health
// body, {} when something answered that is not a Sonorus backend, null when
// nothing answered.
// → { action: 'spawn' | 'reuse' | 'refuse', message }
function reuseDecision(health, { packaged, dataDir, platform }) {
  if (!health) return { action: 'spawn' }
  const isSonorus = health.status === 'ok'

  if (packaged) {
    if (servesDataDir(health, dataDir, platform)) return { action: 'reuse' }
    if (isSonorus && typeof health.data_dir === 'string') {
      const owner = health.packaged ? 'Another Sonorus window' : 'A Sonorus development backend'
      return {
        action: 'refuse',
        message: `${owner} is using port 8000, with its data in ${health.data_dir}.\n\n`
          + 'Close it, then start Sonorus again.',
      }
    }
    return {
      action: 'refuse',
      message: 'Port 8000 is used by another program or by an older version of Sonorus.\n\n'
        + 'Close it, then start Sonorus again.',
    }
  }

  // Dev mode: a backend started by hand (uvicorn) is a documented way to run.
  if (isSonorus && health.packaged !== true) return { action: 'reuse' }
  if (isSonorus) {
    return {
      action: 'refuse',
      message: `The installed Sonorus app is using port 8000, with its data in ${health.data_dir}.\n\n`
        + 'Quit it before starting development mode, so the two do not share data.',
    }
  }
  return {
    action: 'refuse',
    message: 'Port 8000 is used by another program.\n\nClose it, then start Sonorus again.',
  }
}

module.exports = { DEV_DATA_DIR_NAME, devUserDataPath, reuseDecision, servesDataDir }
