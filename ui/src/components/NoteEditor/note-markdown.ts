import type { JSONContent } from '@tiptap/react'
import { formatClock } from '../../media/timeline'

// A speaker as they are now, or null once deleted.
export type ResolveSpeaker = (id: string) => { name: string; handle?: string | null } | null

const marked = (node: JSONContent) => {
  let value = node.text ?? ''
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') value = `**${value}**`
    else if (mark.type === 'italic') value = `*${value}*`
    else if (mark.type === 'link') value = `[${value}](${mark.attrs?.href ?? ''})`
  }
  return value
}

function inline(nodes: JSONContent[] | undefined, resolve: ResolveSpeaker): string {
  return (nodes ?? []).map(node => {
    if (node.type === 'text') return marked(node)
    if (node.type === 'hardBreak') return '  \n'
    if (node.type === 'timecode') return `[${formatClock(node.attrs?.seconds ?? 0)}]`
    if (node.type === 'mention') {
      const { kind, id, label } = node.attrs ?? {}
      if (kind !== 'speaker') return `@${label}`
      const speaker = resolve(id)
      if (!speaker) return label ?? ''
      return speaker.handle ? `${speaker.name} (@${speaker.handle})` : speaker.name
    }
    return ''
  }).join('')
}

const indent = (lines: string, by: string) => lines.split('\n').map((line, i) => (i === 0 || line === '' ? line : by + line)).join('\n')

function block(node: JSONContent, resolve: ResolveSpeaker): string {
  const children = (nodes: JSONContent[] | undefined) => (nodes ?? []).map(child => block(child, resolve))
  switch (node.type) {
    case 'paragraph': return inline(node.content, resolve)
    case 'heading': return `${'#'.repeat(node.attrs?.level ?? 1)} ${inline(node.content, resolve)}`
    case 'blockquote': return children(node.content).join('\n\n').split('\n').map(line => (line ? `> ${line}` : '>')).join('\n')
    case 'bulletList': return children(node.content).map(item => `- ${indent(item, '  ')}`).join('\n')
    case 'orderedList': {
      const first = node.attrs?.start ?? 1
      return children(node.content).map((item, i) => {
        const number = `${first + i}. `
        return number + indent(item, ' '.repeat(number.length))
      }).join('\n')
    }
    case 'taskList': return (node.content ?? []).map(item => `- [${item.attrs?.checked ? 'x' : ' '}] ${indent(block({ ...item, type: 'listItem' }, resolve), '  ')}`).join('\n')
    case 'listItem': return children(node.content).join('\n')
    default: return inline(node.content, resolve)
  }
}

// The note as Markdown, for Copy notes: a speaker as "Name (@handle)", someone not in
// the base as "@Name", a moment as "[12:34]". Empty paragraphs are left out.
export function noteMarkdown(doc: JSONContent, resolve: ResolveSpeaker): string {
  return (doc.content ?? [])
    .filter(node => node.type !== 'paragraph' || (node.content?.length ?? 0) > 0)
    .map(node => block(node, resolve))
    .join('\n\n')
}
