import type { ChainedCommands, Editor } from '@tiptap/core'
import { GapCursor } from '@tiptap/pm/gapcursor'
import { closeHistory } from '@tiptap/pm/history'
import { TextSelection, type Transaction } from '@tiptap/pm/state'

export type HeadingLevel = 1 | 2 | 3
export type ListType = 'bulletList' | 'orderedList' | 'taskList'
export type TextStyle = 'paragraph' | 'h1' | 'h2' | 'h3'

const LEVELS: HeadingLevel[] = [1, 2, 3]

// A click on the free space under the text leaves a cursor between blocks, where no
// format applies. The format goes on the empty paragraph there, or on a new one.
function leaveGap(tr: Transaction) {
  if (!(tr.selection instanceof GapCursor)) return
  const { pos, nodeBefore } = tr.selection.$from
  if (nodeBefore?.type.name === 'paragraph' && nodeBefore.content.size === 0) {
    tr.setSelection(TextSelection.create(tr.doc, pos - 1))
    return
  }
  tr.insert(pos, tr.doc.type.schema.nodes.paragraph.create())
  tr.setSelection(TextSelection.create(tr.doc, pos + 1))
}

// One press is one step of Undo, also right after typing or before typing on: the
// history would otherwise join them, being close in time.
function apply(editor: Editor, build: (chain: ChainedCommands) => ChainedCommands) {
  build(editor.chain().focus().command(({ tr }) => { closeHistory(tr); leaveGap(tr); return true })).run()
  editor.view.dispatch(closeHistory(editor.state.tr))
}

// A list next to the one just made, of the same type, is the same list.
function joinSameLists(tr: Transaction, type: ListType) {
  const { $from } = tr.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name !== type) continue
    const after = $from.after(depth)
    if (tr.doc.resolve(after).nodeAfter?.type.name === type) tr.join(after)
    const before = $from.before(depth)
    if (tr.doc.resolve(before).nodeBefore?.type.name === type) tr.join(before)
    return
  }
}

export const toggleBold = (editor: Editor) => apply(editor, chain => chain.toggleBold())
export const toggleItalic = (editor: Editor) => apply(editor, chain => chain.toggleItalic())
export const toggleBlockquote = (editor: Editor) => apply(editor, chain => chain.toggleBlockquote())
export const setParagraph = (editor: Editor) => apply(editor, chain => chain.setParagraph())
export const toggleHeading = (editor: Editor, level: HeadingLevel) => apply(editor, chain => chain.toggleHeading({ level }))

// Only the blocks selected: they leave what they are in, and a list around them splits.
export function toggleList(editor: Editor, type: ListType) {
  if (editor.isActive(type)) return apply(editor, chain => chain.clearNodes())
  apply(editor, chain => chain.clearNodes().wrapInList(type).command(({ tr }) => { joinSameLists(tr, type); return true }))
}

export function setNoteLink(editor: Editor, href: string) {
  const { from, to, empty } = editor.state.selection
  if (editor.isActive('link')) {
    return apply(editor, chain => chain.extendMarkRange('link').setLink({ href }).setTextSelection({ from, to }))
  }
  if (empty) {
    // The address is the text, an email without its mailto:, and what is typed after it
    // is not part of the link.
    const text = href.replace(/^mailto:/i, '')
    return apply(editor, chain => chain.insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }).unsetMark('link'))
  }
  apply(editor, chain => chain.setLink({ href }))
}

export function removeNoteLink(editor: Editor) {
  const { from, to } = editor.state.selection
  apply(editor, chain => chain.extendMarkRange('link').unsetLink().setTextSelection({ from, to }))
}

export interface FormatState {
  bold: boolean
  italic: boolean
  bulletList: boolean
  orderedList: boolean
  taskList: boolean
  blockquote: boolean
  link: boolean
  textStyle: TextStyle | null
  can: {
    bold: boolean
    italic: boolean
    bulletList: boolean
    orderedList: boolean
    taskList: boolean
    blockquote: boolean
    link: boolean
    paragraph: boolean
    heading: boolean
  }
}

export const NO_FORMAT: FormatState = {
  bold: false, italic: false, bulletList: false, orderedList: false, taskList: false, blockquote: false, link: false, textStyle: null,
  can: { bold: false, italic: false, bulletList: false, orderedList: false, taskList: false, blockquote: false, link: false, paragraph: false, heading: false },
}

// The blocks are made plain first, so a heading or a list item can become a list too,
// which a dry run of the wrap does not see.
function canList(editor: Editor) {
  const { selection } = editor.state
  return !selection.empty || selection.$from.parent.isTextblock
}

export function formatState(editor: Editor): FormatState {
  if (editor.state.selection instanceof GapCursor) {
    return { ...NO_FORMAT, textStyle: 'paragraph', can: Object.fromEntries(Object.keys(NO_FORMAT.can).map(key => [key, true])) as FormatState['can'] }
  }
  const level = LEVELS.find(value => editor.isActive('heading', { level: value }))
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    taskList: editor.isActive('taskList'),
    blockquote: editor.isActive('blockquote'),
    link: editor.isActive('link'),
    textStyle: level ? `h${level}` : editor.isActive('paragraph') ? 'paragraph' : null,
    can: {
      bold: editor.can().toggleBold(),
      italic: editor.can().toggleItalic(),
      bulletList: canList(editor),
      orderedList: canList(editor),
      taskList: canList(editor),
      blockquote: editor.can().toggleBlockquote(),
      link: editor.can().setMark('link', { href: 'https://localhost/' }),
      paragraph: editor.can().setParagraph(),
      heading: LEVELS.some(value => editor.can().toggleHeading({ level: value })),
    },
  }
}
