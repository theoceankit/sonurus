import { describe, expect, test } from 'vitest'
import { mention, paragraph, quoteBlock, rewriteMentions, text, timecode } from './note-content'

const A = 'a0000000-0000-4000-8000-00000000000a'
const B = 'b0000000-0000-4000-8000-00000000000b'

const note = {
  type: 'doc',
  content: [
    paragraph(text('Ask '), { ...mention({ kind: 'speaker', id: A, label: 'Anna' }), marks: [{ type: 'bold' }] }, text(' and '), mention({ kind: 'speaker', id: B, label: 'Mark' })),
    paragraph(mention({ kind: 'person', label: 'Anna' })),
    quoteBlock({ speaker: { kind: 'speaker', id: A, label: 'Anna' }, start: 12, text: 'Hello' }),
  ],
}

describe('mentions of a speaker who is gone', () => {
  test('merged: they mention the speaker merged into, and nothing else changes', () => {
    const after = rewriteMentions(note, { kind: 'merge', from: A, into: B })
    expect(after.content[0].content![1]).toEqual({ ...mention({ kind: 'speaker', id: B, label: 'Anna' }), marks: [{ type: 'bold' }] })
    expect(after.content[2].content![0].content![0].attrs?.id).toBe(B)
    expect(after.content[1]).toBe(note.content[1])
    expect(after.content[2].content![0].content![2]).toEqual(timecode(12))
  })

  test('deleted: each is the name as text, with the marks it had', () => {
    const after = rewriteMentions(note, { kind: 'delete', id: A, name: 'Anna Petrova' })
    expect(after.content[0].content![1]).toEqual(text('Anna Petrova', [{ type: 'bold' }]))
    expect(after.content[2].content![0].content![0]).toEqual(text('Anna Petrova'))
    expect(after.content[0].content![3]).toEqual(mention({ kind: 'speaker', id: B, label: 'Mark' }))
  })

  test('deleted without a name known: the name the mention kept', () => {
    const after = rewriteMentions(note, { kind: 'delete', id: A })
    expect(after.content[0].content![1]).toEqual(text('Anna', [{ type: 'bold' }]))
  })

  test('a person not in the base is never a speaker, even with the same name', () => {
    expect(rewriteMentions(note, { kind: 'delete', id: 'Anna' })).toBe(note)
  })

  test('a note without the speaker is the same document', () => {
    expect(rewriteMentions(note, { kind: 'merge', from: 'c0000000-0000-4000-8000-00000000000c', into: B })).toBe(note)
  })
})
