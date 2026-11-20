// A link in a note opens in the user's own browser or mail app on Ctrl/⌘+click.
// Only web and mail addresses: a file: or app: link from a note must not run
// anything on the computer.
const OPENABLE = new Set(['http:', 'https:', 'mailto:'])

function openableLink(address) {
  if (typeof address !== 'string') return null
  try {
    const url = new URL(address)
    return OPENABLE.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

// → true once handed to the system, false for an address it does not open.
async function openLink(address, { openExternal }) {
  const href = openableLink(address)
  if (!href) return false
  await openExternal(href)
  return true
}

module.exports = { openLink, openableLink }
