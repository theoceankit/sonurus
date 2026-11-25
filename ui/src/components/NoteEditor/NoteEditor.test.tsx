import { act, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { describe, expect, test, vi } from 'vitest'
import type { MentionChange } from './note-content'
import type { NoteWriter } from '../../api/types'
import { NoteEditor, type NoteChangeListener } from './NoteEditor'

function editorWith(content: object | null = null) {
  render(<NoteEditor content={content} findSpeaker={() => null} />)
  return (screen.getByRole('textbox', { name: 'Notes' }) as HTMLElement & { editor: Editor }).editor
}

// Typed as the keyboard does: each character goes through the editor's input rules.
function type(editor: Editor, text: string) {
  for (const char of text) {
    const { view } = editor
    if (char === '\n') {
      editor.commands.first(({ commands }) => [() => commands.splitListItem('listItem'), () => commands.splitListItem('taskItem'), () => commands.enter()])
      continue
    }
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', handle => handle(view, from, to, char, () => view.state.tr.insertText(char, from, to)))
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to))
  }
}

// The blocks typed; the editor keeps an empty paragraph at the end to type after a list.
const blocks = (editor: Editor) => editor.getJSON().content?.filter(node => node.type !== 'paragraph' || node.content)

const shape = (editor: Editor) => JSON.stringify(editor.getJSON(), (key, value) => (key === 'attrs' && value && !('checked' in value) && !('level' in value) ? undefined : value))
const task = (checked: boolean, text: string) => ({ type: 'taskItem', attrs: { checked }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

describe('a checkbox typed as Markdown', () => {
  test.each([
    ['[ ] ', false],
    ['[] ', false],
    ['[x] ', true],
  ])('%s at the start of a line', (mark, checked) => {
    const editor = editorWith()
    type(editor, `${mark}Send the draft`)
    expect(blocks(editor)).toEqual([{ type: 'taskList', content: [task(checked, 'Send the draft')] }])
  })

  test.each([
    ['- [ ] ', false],
    ['- [x] ', true],
    ['* [ ] ', false],
  ])('%s, as in Obsidian, gives a checkbox and not a list with one in it', (mark, checked) => {
    const editor = editorWith()
    type(editor, `${mark}Send the draft`)
    expect(blocks(editor)).toEqual([{ type: 'taskList', content: [task(checked, 'Send the draft')] }])
  })

  test('- [ ] after a plain item makes only the new one a checkbox, and Enter goes on with checkboxes', () => {
    const editor = editorWith()
    type(editor, '- Ship the fix\n[ ] Write the notes\nSend them')
    expect(blocks(editor)).toEqual([
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ship the fix' }] }] }] },
      { type: 'taskList', content: [task(false, 'Write the notes'), task(false, 'Send them')] },
    ])
    expect(shape(editor)).not.toContain('"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph"},{"type":"taskList"')
  })

  test('- [ ] in the middle of a list splits it around the checkbox', () => {
    const item = (text?: string) => ({ type: 'listItem', content: [{ type: 'paragraph', ...(text && { content: [{ type: 'text', text }] }) }] })
    const editor = editorWith({ type: 'doc', content: [{ type: 'bulletList', content: [item('One'), item(), item('Three')] }] })
    // Into the empty middle item: bulletList, the first item, then the second's paragraph.
    editor.commands.setTextSelection(1 + editor.state.doc.child(0).child(0).nodeSize + 2)
    type(editor, '[ ] Two')
    expect(blocks(editor)?.map(node => node.type)).toEqual(['bulletList', 'taskList', 'bulletList'])
    expect(blocks(editor)?.[1]).toEqual({ type: 'taskList', content: [task(false, 'Two')] })
  })

  test('- [ ] right after checkboxes joins them', () => {
    const editor = editorWith({ type: 'doc', content: [{ type: 'taskList', content: [task(true, 'One')] }, { type: 'paragraph' }] })
    editor.commands.focus('end')
    type(editor, '- [ ] Two')
    expect(blocks(editor)).toEqual([{ type: 'taskList', content: [task(true, 'One'), task(false, 'Two')] }])
  })

  test('[ ] in a list item with text before it stays text', () => {
    const editor = editorWith()
    type(editor, '- Plan [ ] later')
    expect(editor.getText().trim()).toBe('Plan [ ] later')
    expect(blocks(editor)?.[0].type).toBe('bulletList')
  })
})

describe('a timecode', () => {
  test('as plain text, such as a copy from the note, reads as the chip does', () => {
    const editor = editorWith({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Agreed ' }, { type: 'timecode', attrs: { seconds: 754 } }, { type: 'text', text: ' and ' }, { type: 'timecode', attrs: { seconds: 3725 } }] }] })
    expect(editor.getText()).toBe('Agreed [12:34] and [1:02:05]')
  })
})

describe('mentions of a speaker who is gone, in an open note', () => {
  const A = 'a0000000-0000-4000-8000-00000000000a'
  const B = 'b0000000-0000-4000-8000-00000000000b'
  const doc = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Ask ' },
      { type: 'mention', attrs: { kind: 'speaker', id: A, label: 'Anna' } },
      { type: 'text', text: ' and ' },
      { type: 'mention', attrs: { kind: 'speaker', id: B, label: 'Mark' } },
    ] }],
  }

  function open() {
    let listener: ((change: MentionChange) => void) | null = null
    const subscribe = (next: (change: MentionChange) => void) => {
      listener = next
      return () => { listener = null }
    }
    const onChange = vi.fn()
    const view = render(<NoteEditor content={doc} findSpeaker={() => null} mentionChanges={subscribe} onChange={onChange} />)
    const editor = (screen.getByRole('textbox', { name: 'Notes' }) as HTMLElement & { editor: Editor }).editor
    const send = (change: MentionChange) => act(() => listener?.(change))
    return { editor, send, onChange, view, listening: () => listener !== null }
  }
  const mentions = (editor: Editor) => ((editor.getJSON() as JSONContent).content![0].content ?? []).filter(node => node.type === 'mention').map(node => node.attrs?.id)

  test('merged: they follow the speaker merged into, and the change is saved', () => {
    const { editor, send, onChange } = open()
    send({ kind: 'merge', from: A, into: B })
    expect(mentions(editor)).toEqual([B, B])
    expect(onChange).toHaveBeenCalled()
  })

  test('deleted: the name as text; Undo does not bring the speaker back', () => {
    const { editor, send } = open()
    send({ kind: 'delete', id: A, name: 'Anna Petrova' })
    expect(editor.getText()).toBe('Ask Anna Petrova and @Mark')
    expect(mentions(editor)).toEqual([B])
    act(() => { editor.commands.undo() })
    expect(mentions(editor)).toEqual([B])
  })

  test('another speaker leaves the note as it is', () => {
    const { editor, send, onChange } = open()
    send({ kind: 'merge', from: 'c0000000-0000-4000-8000-00000000000c', into: B })
    expect(mentions(editor)).toEqual([A, B])
    expect(onChange).not.toHaveBeenCalled()
  })

  test('the note stops listening once it closes', () => {
    const { view, listening } = open()
    expect(listening()).toBe(true)
    view.unmount()
    expect(listening()).toBe(false)
  })
})

describe('the note changed elsewhere', () => {
  const p = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

  function open(content: JSONContent) {
    let listener: NoteChangeListener | null = null
    const subscribe = (next: NoteChangeListener) => {
      listener = next
      return () => { listener = null }
    }
    const onChange = vi.fn()
    const transactions: { external: unknown; history: unknown }[] = []
    const view = render(<NoteEditor content={content} findSpeaker={() => null} changesFromElsewhere={subscribe} onChange={onChange} />)
    const editor = (screen.getByRole('textbox', { name: 'Notes' }) as HTMLElement & { editor: Editor }).editor
    editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) transactions.push({ external: transaction.getMeta('external'), history: transaction.getMeta('addToHistory') })
    })
    const send = (note: JSONContent, writer: NoteWriter | null = null) => act(() => listener?.(note, writer))
    return { editor, send, onChange, view, transactions, listening: () => listener !== null }
  }

  test('it shows the new version, as one step marked as from elsewhere, with who wrote it', () => {
    const { editor, send, onChange, transactions } = open(doc(p('first'), p('second')))
    send(doc(p('first'), p('second'), p('by the agent')), { kind: 'mcp', name: 'Claude Code' })
    expect(editor.getText({ blockSeparator: '|' })).toBe('first|second|by the agent')
    expect(transactions).toEqual([{ external: { writer: { kind: 'mcp', name: 'Claude Code' } }, history: false }])
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  test('the cursor stays where it was in a paragraph the change left alone', () => {
    const { editor, send } = open(doc(p('first'), p('second')))
    act(() => { editor.commands.setTextSelection(4) })
    send(doc(p('first'), p('second, theirs')))
    expect(editor.state.selection.from).toBe(4)
    send(doc(p('before'), p('first'), p('second, theirs')))
    expect(editor.state.doc.textBetween(editor.state.selection.from - 3, editor.state.selection.from)).toBe('fir')
  })

  test('a cursor before what was added in its paragraph stays', () => {
    const { editor, send } = open(doc(p('first'), p('second')))
    act(() => { editor.commands.setTextSelection(10) })
    send(doc(p('first'), p('second, theirs')))
    expect(editor.state.selection.from).toBe(10)
  })

  test('a cursor in text that was replaced goes to the end of the change', () => {
    const { editor, send } = open(doc(p('first'), p('second')))
    act(() => { editor.commands.setTextSelection(10) })
    send(doc(p('first'), p('SECOND theirs')))
    const at = editor.state.selection.from
    expect(editor.state.doc.textBetween(at - 6, at)).toBe('theirs')
  })

  test('Undo takes back what was typed here, never the change from elsewhere', () => {
    const { editor, send } = open(doc(p('first')))
    act(() => { editor.commands.setTextSelection(6) })
    type(editor, ' typed')
    send(doc(p('first typed'), p('by the agent')))
    act(() => { editor.commands.undo() })
    expect(editor.getText({ blockSeparator: '|' })).toBe('first|by the agent')
    act(() => { editor.commands.undo() })
    expect(editor.getText({ blockSeparator: '|' })).toBe('first|by the agent')
  })

  test('the same document changes nothing', () => {
    const { send, onChange, transactions } = open(doc(p('first')))
    send(doc(p('first')))
    expect(transactions).toEqual([])
    expect(onChange).not.toHaveBeenCalled()
  })

  test('the note stops listening once it closes', () => {
    const { view, listening } = open(doc(p('first')))
    expect(listening()).toBe(true)
    view.unmount()
    expect(listening()).toBe(false)
  })
})
