// One word gives its first two letters, several give the first letter of the
// first and of the last word. Only Avatar may call this; a test enforces it.
export function speakerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return [...parts[0]].slice(0, 2).join('').toUpperCase()
  return ([...parts[0]][0] + [...parts[parts.length - 1]][0]).toUpperCase()
}
