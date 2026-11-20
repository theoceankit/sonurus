import { Extension } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useReducer, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../../styles/cx'
import { mentionList, type MentionCandidate, type MentionOption } from '../MentionList/mention-list'
import { MentionList } from '../MentionList/MentionList'
import { quoteBlock, timecode, type NoteQuote } from './note-content'
import { NoteChips, NoteLink, NoteMention, Timecode, type FindSpeaker } from './note-extensions'
import styles from './NoteEditor.module.css'

export interface NoteEditorHandle {
  // At the cursor, or at the end when the note has not been in focus.
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
  findSpeaker: FindSpeaker
  onSeek?: (seconds: number) => void
  onChange?: (doc: JSONContent) => void
  // The shortcut for the player's time; the panel knows the time.
  onTimeShortcut?: () => void
  // Ctrl/⌘+click on a link; a plain click only puts the cursor there.
  onOpenLink?: (href: string) => void
  // Tab: the column of the right panel. Expanded: in place of the transcript.
  size?: 'tab' | 'expanded'
  autoFocus?: boolean
  className?: string
  ref?: Ref<NoteEditorHandle>
}

const PLACEHOLDER = 'Write notes for this recording. Markdown works as you type: # for a heading, - for a list, [ ] for a checkbox'
const placeholder = (mentions: boolean) => `${PLACEHOLDER}${mentions ? ', @ to mention someone' : ''}.`

const POPUP_GAP = 4

interface Suggesting {
  query: string
  command: (attrs: object) => void
  rect: () => DOMRect | null
  active: number
}

// A note in basic Markdown, rendered as it is typed: headings, bold, italic, lists,
// checkboxes, quotes and links, with timecodes and mentions as chips.
export function NoteEditor({
  content, candidates, findSpeaker, onSeek, onChange, onTimeShortcut, onOpenLink, size = 'tab', autoFocus, className, ref,
}: NoteEditorProps) {
  const [suggesting, setSuggesting] = useState<Suggesting | null>(null)
  const latest = useRef({ suggesting, candidates, onChange, onTimeShortcut, onOpenLink })
  latest.current = { suggesting, candidates, onChange, onTimeShortcut, onOpenLink }

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
      Placeholder.configure({ placeholder: () => placeholder(latest.current.candidates !== undefined) }),
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
      Extension.create({
        name: 'playerTime',
        addKeyboardShortcuts: () => ({
          'Mod-t': () => {
            const insert = latest.current.onTimeShortcut
            insert?.()
            return insert !== undefined
          },
        }),
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
  })

  useImperativeHandle(ref, () => ({
    insertTimecode: seconds => {
      if (!editor) return
      const chain = editor.chain()
      ;(editor.isFocused ? chain.focus() : chain.focus('end')).insertContent([timecode(seconds), { type: 'text', text: ' ' }]).run()
    },
    insertQuotes: quotes => {
      if (!editor || quotes.length === 0) return
      editor.chain().focus(editor.isFocused ? undefined : 'end').insertContent([...quotes.map(quoteBlock), { type: 'paragraph' }]).run()
    },
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
}
