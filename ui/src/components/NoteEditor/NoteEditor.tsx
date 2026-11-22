import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import { memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useReducer, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../../styles/cx'
import { mentionList, type MentionCandidate, type MentionOption } from '../MentionList/mention-list'
import { MentionList } from '../MentionList/MentionList'
import { quoteBlock, timecode, type MentionChange, type NoteQuote } from './note-content'
import { KeptSelection, NoteChips, NoteLink, NoteMention, TaskFromListItem, Timecode, type FindSpeaker } from './note-extensions'
import styles from './NoteEditor.module.css'

export interface NoteEditorHandle {
  // Where the cursor was last, or at the end when the note has not been in focus since
  // it opened. Both take the focus, to go on typing after them.
  insertTimecode: (seconds: number) => void
  insertQuotes: (quotes: NoteQuote[]) => void
  // For a story: text typed at the end, as from the keyboard.
  type: (text: string) => void
  getJSON: () => JSONContent | null
  focus: () => void
}

interface NoteEditorProps {
  content?: JSONContent | null
  // Who @ offers; without them @ is plain text.
  candidates?: readonly MentionCandidate[]
  // Speakers merged or deleted while the note is open: its mentions follow, as the
  // backend has done with the notes it keeps. Returns a way to stop listening.
  mentionChanges?: (listener: (change: MentionChange) => void) => () => void
  findSpeaker: FindSpeaker
  onSeek?: (seconds: number) => void
  onChange?: (doc: JSONContent) => void
  // The editor once it is made, for the format bar.
  onEditor?: (editor: Editor | null) => void
  // Quotes to insert as soon as the editor is there, each array once; onQuoted says
  // they are in. The editor may be made again as it mounts, so a handle could still
  // point at the one that went.
  quotes?: NoteQuote[] | null
  onQuoted?: () => void
  // Ctrl/⌘+click on a link; a plain click only puts the cursor there.
  onOpenLink?: (href: string) => void
  // Tab: the column of the right panel. Expanded: in place of the transcript.
  size?: 'tab' | 'expanded'
  autoFocus?: boolean
  className?: string
  ref?: Ref<NoteEditorHandle>
}

const PLACEHOLDER = 'Write notes'

const POPUP_GAP = 4

// The mentions of a speaker who is gone, rewritten in one step that Undo leaves
// alone: Undo cannot bring back a speaker. Null when the note does not mention them.
function followSpeaker(state: EditorState, change: MentionChange): Transaction | null {
  const id = change.kind === 'merge' ? change.from : change.id
  const found: { pos: number; node: PMNode }[] = []
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'mention' && node.attrs.kind === 'speaker' && node.attrs.id === id) found.push({ pos, node })
  })
  if (found.length === 0) return null
  const tr = state.tr
  for (const { pos, node } of found.reverse()) {
    if (change.kind === 'merge') {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: change.into })
      continue
    }
    const name = change.name || (node.attrs.label as string)
    if (name) tr.replaceWith(pos, pos + node.nodeSize, state.schema.text(name, node.marks))
    else tr.delete(pos, pos + node.nodeSize)
  }
  return tr.setMeta('addToHistory', false)
}

interface Suggesting {
  query: string
  command: (attrs: object) => void
  rect: () => DOMRect | null
  active: number
}

// A note in basic Markdown, rendered as it is typed: headings, bold, italic, lists,
// checkboxes, quotes and links, with timecodes and mentions as chips. It renders again
// only when what it is given changes, not with the player's time over it.
export const NoteEditor = memo(function NoteEditor({
  content, candidates, mentionChanges, findSpeaker, onSeek, onChange, onEditor, quotes, onQuoted, onOpenLink, size = 'tab', autoFocus, className, ref,
}: NoteEditorProps) {
  const [suggesting, setSuggesting] = useState<Suggesting | null>(null)
  const latest = useRef({ suggesting, candidates, onChange, onOpenLink })
  latest.current = { suggesting, candidates, onChange, onOpenLink }
  // Whether the cursor has been in the note since it opened: the editor keeps where it
  // was after the focus goes, and what is inserted goes there.
  const visited = useRef(Boolean(autoFocus))

  const options = (state: Suggesting | null) => (state ? mentionList(latest.current.candidates ?? [], state.query).options : [])
  const choose = (option: MentionOption | undefined, state: Suggesting | null) => {
    if (!option || !state) return
    state.command(option.kind === 'speaker'
      ? { id: option.speaker.id, label: option.speaker.name, kind: 'speaker' }
      : { id: null, label: option.name, kind: 'person' })
  }

  const extensions = useMemo(() => {
    const fromProps = (props: SuggestionProps, active = 0): Suggesting => ({ query: props.query, command: props.command, rect: () => props.clientRect?.() ?? null, active })
    return [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: false,
      }),
      NoteLink.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TaskFromListItem,
      Placeholder.configure({ placeholder: PLACEHOLDER }),
      // What is selected stays visible while the link window or a menu has the focus.
      KeptSelection.configure({ className: styles.keptSelection }),
      Timecode,
      NoteMention.configure({
        suggestion: {
          char: '@',
          allowSpaces: true,
          allow: () => latest.current.candidates !== undefined,
          items: () => [],
          render: () => ({
            onStart: props => setSuggesting(fromProps(props)),
            onUpdate: props => setSuggesting(current => fromProps(props, current?.query === props.query ? current.active : 0)),
            onExit: () => setSuggesting(null),
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              const state = latest.current.suggesting
              if (!state) return false
              const count = options(state).length
              if (event.key === 'Escape') {
                setSuggesting(null)
                return true
              }
              if (count === 0) return false
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                const step = event.key === 'ArrowDown' ? 1 : -1
                setSuggesting({ ...state, active: (state.active + step + count) % count })
                return true
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                choose(options(state)[state.active], state)
                return true
              }
              return false
            },
          }),
        },
      }),
    ]
  // The editor is made once; what changes is read through `latest`.
  }, [])

  const editor = useEditor({
    extensions,
    content: content ?? undefined,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: cx(styles.prose, styles[size]), 'aria-label': 'Notes', 'aria-multiline': 'true', role: 'textbox' },
      handleDOMEvents: {
        // The window never follows a link; Ctrl/⌘+click hands it to the system.
        click: (_view, event) => {
          const link = event.target instanceof Element ? event.target.closest('a[href]') : null
          if (!link) return false
          event.preventDefault()
          const href = link.getAttribute('href')
          if (href && (event.ctrlKey || event.metaKey)) latest.current.onOpenLink?.(href)
          return false
        },
      },
    },
    onUpdate: ({ editor: changed }) => latest.current.onChange?.(changed.getJSON()),
    onFocus: () => { visited.current = true },
  })
  useEffect(() => { onEditor?.(editor) }, [editor, onEditor])

  // Where an insert goes: the cursor as the note left it, or the end. A chip selected
  // by a click on it stays, with the insert after it.
  const at = () => {
    if (!visited.current) return 'end'
    const selection = editor?.state.selection
    return selection instanceof NodeSelection ? selection.to : null
  }

  const insertQuotes = (quotes: NoteQuote[]) => {
    if (!editor || editor.isDestroyed || quotes.length === 0) return
    editor.chain().focus(at()).insertContent([...quotes.map(quoteBlock), { type: 'paragraph' }]).run()
  }
  const inserted = useRef<NoteQuote[] | null>(null)
  useEffect(() => {
    if (!quotes || !editor || editor.isDestroyed || inserted.current === quotes) return
    inserted.current = quotes
    insertQuotes(quotes)
    onQuoted?.()
  })

  useEffect(() => {
    if (!editor || !mentionChanges) return
    return mentionChanges(change => {
      if (editor.isDestroyed) return
      const tr = followSpeaker(editor.state, change)
      if (tr) editor.view.dispatch(tr)
    })
  }, [editor, mentionChanges])

  useImperativeHandle(ref, () => ({
    insertTimecode: seconds => {
      if (!editor || editor.isDestroyed) return
      editor.chain().focus(at()).insertContent([timecode(seconds), { type: 'text', text: ' ' }]).run()
    },
    insertQuotes,
    type: text => { editor?.chain().focus('end').insertContent(text).run() },
    getJSON: () => editor?.getJSON() ?? null,
    focus: () => { editor?.commands.focus() },
  }), [editor])

  const chips = useMemo(() => ({ findSpeaker, onSeek }), [findSpeaker, onSeek])
  const list = suggesting && mentionList(candidates ?? [], suggesting.query)

  // The list follows the @ when the note scrolls, and opens above it near the bottom.
  const [, reposition] = useReducer((n: number) => n + 1, 0)
  const open = suggesting !== null
  useEffect(() => {
    if (!open) return
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])
  const popup = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => { if (popup.current) setHeight(popup.current.offsetHeight) })
  const rect = suggesting?.rect()
  const fitsBelow = rect ? rect.bottom + POPUP_GAP + height <= window.innerHeight : true
  const top = rect ? (fitsBelow ? rect.bottom + POPUP_GAP : rect.top - POPUP_GAP - height) : 0

  return (
    <NoteChips.Provider value={chips}>
      <EditorContent editor={editor} className={cx(styles.editor, className)} />
      {suggesting && list && list.options.length > 0 && rect && createPortal(
        <MentionList
          ref={popup}
          sections={list.sections}
          active={suggesting.active}
          onHover={index => setSuggesting(current => current && { ...current, active: index })}
          onSelect={option => choose(option, suggesting)}
          className={styles.popup}
          style={{ left: rect.left, top }}
        />,
        document.body,
      )}
    </NoteChips.Provider>
  )
})
