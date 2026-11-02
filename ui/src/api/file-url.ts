// Filesystem path → file:// URL. Every path segment is percent-encoded so
// spaces, non-ASCII, '#' and '?' survive; Windows drive letters are kept.
export function fileUrl(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/')
  const encoded = segments.map(segment => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment))).join('/')
  return `file://${encoded.startsWith('/') ? encoded : `/${encoded}`}`
}
