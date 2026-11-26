// The backend refuses a database it cannot bring up to its schema
// (app/db/migrations.py) and says why on a line of its own in stderr before it
// exits. This turns that line into what the start-up dialog says.

const MARKER = 'SONORUS_DB_REFUSED'

const MESSAGES = {
  newer: 'Your Sonorus data was saved by a newer version of Sonorus, and this version cannot open it.\n\n' +
    'Install the latest version of Sonorus to open it. Your data has not been changed.',
  unsupported: 'Your Sonorus data is from a version of Sonorus this version cannot open: one older than 0.2.0, ' +
    'or data changed outside the app.\n\nYour data has not been changed.',
}

// The dialog's message for the backend's stderr output, or null when the
// backend refused no database.
function databaseRefusal(output, dataDir) {
  const match = new RegExp(`^${MARKER} (\\w+)\\r?$`, 'm').exec(output)
  if (!match) return null
  const message = MESSAGES[match[1]] ?? MESSAGES.unsupported
  return `${message}\n\nData folder: ${dataDir}`
}

module.exports = { MARKER, databaseRefusal }
