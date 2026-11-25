import type { JSONContent } from '@tiptap/react'
import { describe, expect, test } from 'vitest'
import { mergeNotes, sameNote } from './note-merge'

const p = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const h = (text: string): JSONContent => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const li = (text: string): JSONContent => ({ type: 'listItem', content: [p(text)] })
const ul = (...items: string[]): JSONContent => ({ type: 'bulletList', content: items.map(li) })
const task = (text: string, checked = false): JSONContent => ({ type: 'taskItem', attrs: { checked }, content: [p(text)] })
const tasks = (...items: JSONContent[]): JSONContent => ({ type: 'taskList', content: items })
const quote = (...blocks: JSONContent[]): JSONContent => ({ type: 'blockquote', content: blocks })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const EMPTY = doc({ type: 'paragraph' })

describe('mergeNotes', () => {
  test('nothing changed on either side', () => {
    const base = doc(p('a'), p('b'))
    expect(mergeNotes(base, base, base)).toEqual({ doc: base, conflicts: 0 })
  })

  test('a change made only elsewhere is taken', () => {
    const base = doc(p('a'), p('b'))
    const remote = doc(p('a'), p('b'), p('c'))
    expect(mergeNotes(base, base, remote)).toEqual({ doc: remote, conflicts: 0 })
  })

  test('a change made only here is kept', () => {
    const base = doc(p('a'), p('b'))
    const local = doc(p('a!'), p('b'))
    expect(mergeNotes(base, local, base)).toEqual({ doc: local, conflicts: 0 })
  })

  test('the same change on both sides is taken once', () => {
    const base = doc(p('a'))
    const both = doc(p('a'), p('b'))
    expect(mergeNotes(base, both, both)).toEqual({ doc: both, conflicts: 0 })
  })

  test('an agent appends while the user edits an earlier paragraph', () => {
    const base = doc(h('Minutes'), p('first'), p('second'))
    const local = doc(h('Minutes'), p('first, typed'), p('second'))
    const remote = doc(h('Minutes'), p('first'), p('second'), h('Summary'), p('by the agent'))
    expect(mergeNotes(base, local, remote)).toEqual({
      doc: doc(h('Minutes'), p('first, typed'), p('second'), h('Summary'), p('by the agent')),
      conflicts: 0,
    })
  })

  test('an agent appends right after the paragraph the user is typing in', () => {
    const base = doc(p('first'), p('last'))
    const local = doc(p('first'), p('last, typed'))
    const remote = doc(p('first'), p('last'), p('by the agent'))
    expect(mergeNotes(base, local, remote)).toEqual({ doc: doc(p('first'), p('last, typed'), p('by the agent')), conflicts: 0 })
  })

  test('an agent adds before the paragraph the user is typing in', () => {
    const base = doc(p('first'))
    const local = doc(p('first, typed'))
    const remote = doc(h('Summary'), p('first'))
    expect(mergeNotes(base, local, remote)).toEqual({ doc: doc(h('Summary'), p('first, typed')), conflicts: 0 })
  })

  test('edits of different paragraphs both stay', () => {
    const base = doc(p('a'), p('b'), p('c'))
    const local = doc(p('A'), p('b'), p('c'))
    const remote = doc(p('a'), p('b'), p('C'))
    expect(mergeNotes(base, local, remote)).toEqual({ doc: doc(p('A'), p('b'), p('C')), conflicts: 0 })
  })

  test('the same paragraph changed on both sides keeps both, theirs first', () => {
    const base = doc(p('a'), p('b'), p('c'))
    const local = doc(p('a'), p('b, mine'), p('c'))
    const remote = doc(p('a'), p('b, theirs'), p('c'))
    expect(mergeNotes(base, local, remote)).toEqual({
      doc: doc(p('a'), p('b, theirs'), p('b, mine'), p('c')),
      conflicts: 1,
    })
  })

  test('two places in conflict count twice', () => {
    const base = doc(p('a'), p('b'), p('c'))
    const local = doc(p('a1'), p('b'), p('c1'))
    const remote = doc(p('a2'), p('b'), p('c2'))
    expect(mergeNotes(base, local, remote)).toEqual({
      doc: doc(p('a2'), p('a1'), p('b'), p('c2'), p('c1')),
      conflicts: 2,
    })
  })

  test('both sides adding at the same place keep both', () => {
    const base = doc(p('a'))
    const local = doc(p('a'), p('mine'))
    const remote = doc(p('a'), p('theirs'))
    expect(mergeNotes(base, local, remote)).toEqual({ doc: doc(p('a'), p('theirs'), p('mine')), conflicts: 1 })
  })

  // Nothing of either side is lost: the edit stays, as the only version there is.
  test('a paragraph deleted elsewhere but edited here is kept', () => {
    const base = doc(p('a'), p('b'), p('c'))
    const local = doc(p('a'), p('b, edited'), p('c'))
    const remote = doc(p('a'), p('c'))
    expect(mergeNotes(base, local, remote)).toEqual({ doc: doc(p('a'), p('b, edited'), p('c')), conflicts: 0 })
  })

  test('a paragraph deleted here but edited elsewhere is kept', () => {
    const base = doc(p('a'), p('b'), p('c'))
    const local = doc(p('a'), p('c'))
    const remote = doc(p('a'), p('b, edited'), p('c'))
    expect(mergeNotes(base, local, remote)).toEqual({ doc: doc(p('a'), p('b, edited'), p('c')), conflicts: 0 })
  })

  test('a paragraph deleted on one side and untouched on the other goes', () => {
    const base = doc(p('a'), p('b'), p('c'))
    expect(mergeNotes(base, doc(p('a'), p('c')), base).doc).toEqual(doc(p('a'), p('c')))
    expect(mergeNotes(base, base, doc(p('a'), p('c'))).doc).toEqual(doc(p('a'), p('c')))
  })

  test('items of one list edited on each side merge inside the list', () => {
    const base = doc(ul('one', 'two', 'three'))
    const local = doc(ul('one, mine', 'two', 'three'))
    const remote = doc(ul('one', 'two', 'three, theirs', 'four'))
    expect(mergeNotes(base, local, remote)).toEqual({
      doc: doc(ul('one, mine', 'two', 'three, theirs', 'four')),
      conflicts: 0,
    })
  })

  test('the same item edited on both sides keeps both items in the list', () => {
    const base = doc(ul('one', 'two'))
    const local = doc(ul('one, mine', 'two'))
    const remote = doc(ul('one, theirs', 'two'))
    expect(mergeNotes(base, local, remote)).toEqual({
      doc: doc({ type: 'bulletList', content: [li('one, theirs'), li('one, mine'), li('two')] }),
      conflicts: 1,
    })
  })

  test('a checkbox ticked here while its text changed elsewhere gets both', () => {
    const base = doc(tasks(task('send'), task('call')))
    const local = doc(tasks(task('send', true), task('call')))
    const remote = doc(tasks(task('send the draft'), task('call')))
    expect(mergeNotes(base, local, remote)).toEqual({
      doc: doc(tasks(task('send the draft', true), task('call'))),
      conflicts: 0,
    })
  })

  test('paragraphs in a quote merge inside the quote', () => {
    const base = doc(quote(p('who'), p('said')))
    const local = doc(quote(p('who, mine'), p('said')))
    const remote = doc(quote(p('who'), p('said, theirs')))
    expect(mergeNotes(base, local, remote)).toEqual({ doc: doc(quote(p('who, mine'), p('said, theirs'))), conflicts: 0 })
  })

  test('a block whose type changed on one side is not merged into', () => {
    const base = doc(ul('one'))
    const local = doc(ul('one, mine'))
    const remote = doc({ type: 'orderedList', attrs: { start: 1, type: null }, content: [li('one')] })
    expect(mergeNotes(base, local, remote).conflicts).toBe(1)
  })

  test('no note or an empty one is the same as an empty document', () => {
    const remote = doc(p('by the agent'))
    expect(mergeNotes(null, null, remote)).toEqual({ doc: remote, conflicts: 0 })
    expect(mergeNotes(null, EMPTY, remote)).toEqual({ doc: remote, conflicts: 0 })
    expect(mergeNotes(EMPTY, doc(p('mine')), null)).toEqual({ doc: doc(p('mine')), conflicts: 0 })
  })

  test('a note deleted elsewhere with nothing typed here is empty', () => {
    const base = doc(p('a'))
    expect(sameNote(mergeNotes(base, base, null).doc, null)).toBe(true)
  })

  test('a note deleted elsewhere keeps what was typed here', () => {
    const base = doc(p('a'))
    const local = doc(p('a'), p('typed'))
    expect(mergeNotes(base, local, null).doc).toEqual(doc(p('typed')))
  })

  test('the documents given are not changed', () => {
    const base = doc(ul('one', 'two'))
    const local = doc(ul('one, mine', 'two'))
    const remote = doc(ul('one', 'two, theirs'))
    const copies = structuredClone([base, local, remote])
    mergeNotes(base, local, remote)
    expect([base, local, remote]).toEqual(copies)
  })
})

describe('sameNote', () => {
  test('null, an empty document and one empty paragraph are the same', () => {
    expect(sameNote(null, EMPTY)).toBe(true)
    expect(sameNote(doc(), null)).toBe(true)
  })

  test('the order of keys and attributes left null do not count', () => {
    const a = { type: 'doc', content: [{ content: [{ text: 'x', type: 'text' }], type: 'paragraph' }] }
    expect(sameNote(a, doc(p('x')))).toBe(true)
    expect(sameNote(
      doc({ type: 'orderedList', attrs: { start: 1, type: null }, content: [li('a')] }),
      doc({ type: 'orderedList', attrs: { start: 1 }, content: [li('a')] }),
    )).toBe(true)
  })

  test('different text is different', () => {
    expect(sameNote(doc(p('a')), doc(p('b')))).toBe(false)
    expect(sameNote(doc(p('a')), null)).toBe(false)
  })
})
