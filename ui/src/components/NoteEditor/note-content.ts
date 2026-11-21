import type { JSONContent } from '@tiptap/react'

// What a mention keeps: a speaker by id, with the name it had when last seen, so a
// deleted speaker still reads as someone; a person not in the base by the name alone.
export type MentionAttrs =
  | { kind: 'speaker'; id: string; label: string }
  | { kind: 'person'; id?: null; label: string }

// A piece of the transcript taken into the note: who said it, from when, and what.
export interface NoteQuote {
  speaker: MentionAttrs
  start: number
  text: string
}

export const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: value, ...(marks && { marks }) })
export const mention = (attrs: MentionAttrs): JSONContent => ({ type: 'mention', attrs: { id: attrs.id ?? null, label: attrs.label, kind: attrs.kind } })
export const timecode = (seconds: number): JSONContent => ({ type: 'timecode', attrs: { seconds } })
export const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', ...(content.length > 0 && { content }) })

// A quote opens with who and when, then what was said.
export const quoteBlock = ({ speaker, start, text: said }: NoteQuote): JSONContent => ({
  type: 'blockquote',
  content: [paragraph(mention(speaker), text(' '), timecode(start)), paragraph(text(said))],
})

export const isEmptyNote = (doc: JSONContent | null | undefined) =>
  !doc?.content?.some(node => node.type !== 'paragraph' || (node.content?.length ?? 0) > 0)

// A speaker who is gone from the base, for the notes that mention them: merged into
// another speaker, who the mentions follow, or deleted, when each mention becomes
// the name as plain text.
export type MentionChange =
  | { kind: 'merge'; from: string; into: string }
  | { kind: 'delete'; id: string; name?: string | null }

// A note with a change applied, as the backend applies it to the notes it keeps; the
// same document when nothing in it mentions the speaker.
export function rewriteMentions<T extends JSONContent>(doc: T, change: MentionChange): T {
  const id = change.kind === 'merge' ? change.from : change.id
  const walk = (node: JSONContent): JSONContent => {
    if (!node.content) return node
    let changed = false
    const content = node.content.flatMap((child): JSONContent[] => {
      const attrs = child.attrs ?? {}
      if (child.type === 'mention' && (attrs.kind ?? 'speaker') === 'speaker' && attrs.id === id) {
        changed = true
        if (change.kind === 'merge') return [{ ...child, attrs: { ...attrs, id: change.into } }]
        const name = change.name || attrs.label
        return name ? [text(name, child.marks)] : []
      }
      const next = walk(child)
      if (next !== child) changed = true
      return [next]
    })
    return changed ? { ...node, content } : node
  }
  return walk(doc) as T
}
