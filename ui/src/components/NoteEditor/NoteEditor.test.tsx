import { render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { describe, expect, test } from 'vitest'
import { NoteEditor } from './NoteEditor'

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
