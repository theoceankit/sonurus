export type NoteLinkResult = { href: string; error?: never } | { href?: never; error: string }

const INVALID = 'Enter a web or mailto address'
const DEFAULT_SCHEME = 'https://'
const ALLOWED = new Set(['http:', 'https:', 'mailto:'])

// "example.com:8080" and "localhost:3000" have a port and not a scheme.
const SCHEME = /^[a-z][a-z0-9+-]*:/i
const HOST_WITH_PORT = /^(localhost|[^/:@]+\.[^/:@]+):\d+(\/|$)/i
// With no scheme: a name with a dot, or localhost.
const BARE_HOST = /^(localhost|[^/?#@:]+\.[^/?#@:]+)(:\d+)?([/?#]|$)/i
// An email address is mail: with https:// it would open the site of its domain.
const BARE_EMAIL = /^[^/?#@:]+@[^/?#@:]+\.[^/?#@:]+$/

// What the link window accepts, as the address to store. Opening a link checks it
// again in the main process (electron/links.js).
export function parseNoteLink(value: string): NoteLinkResult {
  const address = value.trim()
  if (!address || /[\s\u0000-\u001f]/.test(address)) return { error: INVALID }
  if (BARE_EMAIL.test(address)) return { href: `mailto:${address}` }
  const hasScheme = SCHEME.test(address) && !HOST_WITH_PORT.test(address)
  if (!hasScheme && !BARE_HOST.test(address)) return { error: INVALID }
  const href = hasScheme ? address : DEFAULT_SCHEME + address
  try {
    const url = new URL(href)
    if (!ALLOWED.has(url.protocol)) return { error: INVALID }
    if (url.protocol === 'mailto:' ? !url.pathname : !url.hostname) return { error: INVALID }
  } catch {
    return { error: INVALID }
  }
  return { href }
}
