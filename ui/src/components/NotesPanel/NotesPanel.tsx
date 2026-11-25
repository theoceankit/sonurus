import type { Editor, JSONContent } from '@tiptap/react'
import { useCallback, useContext, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../../styles/cx'
import { IconButton } from '../IconButton/IconButton'
import { Inline } from '../Inline/Inline'
import { InspectorActions } from '../Inspector/inspector-actions'
import type { MentionCandidate } from '../MentionList/mention-list'
import { isEmptyNote, type MentionChange, type NoteQuote } from '../NoteEditor/note-content'
import type { FindSpeaker } from '../NoteEditor/note-extensions'
import { noteMarkdown } from '../NoteEditor/note-markdown'
import { NoteEditor, type NoteChangeListener, type NoteEditorHandle } from '../NoteEditor/NoteEditor'
import { NoteFormatBar } from '../NoteFormatBar/NoteFormatBar'
import { ScrollBar } from '../ScrollBar/ScrollBar'
import { ScrollFade, useScrollEdges } from '../ScrollFade/ScrollFade'
import { Tooltip, TooltipGroup } from '../Tooltip/Tooltip'
import styles from './NotesPanel.module.css'

export interface NotesPanelHandle {
  insertQuotes: (quotes: NoteQuote[]) => void
  // For a story: text typed at the end, as from the keyboard.
  type: (text: string) => void
}

interface NotesPanelProps {
  // Tab: in the right panel. Expanded: in place of the transcript.
  mode?: 'tab' | 'expanded'
  // The recording, over the expanded note.
  title?: string
  content?: JSONContent | null
  // Who @ offers; without them @ is plain text.
  candidates?: readonly MentionCandidate[]
  // Speakers merged or deleted while the note is open (see NoteEditor).
  mentionChanges?: (listener: (change: MentionChange) => void) => () => void
  // The note changed elsewhere, merged with what was typed: the editor shows it.
  changesFromElsewhere?: (listener: NoteChangeListener) => () => void
  findSpeaker: FindSpeaker
  // Where the player stands, to the second: what the time button inserts. Without
  // it there is no time button.
  time?: number
  // While the player has no audio: the button stays, out of use.
  timeDisabled?: boolean
  onSeek?: (seconds: number) => void
  onChange?: (doc: JSONContent) => void
  // Quotes from the transcript to insert once the editor is there; onQuoted says they are in.
  quotes?: NoteQuote[] | null
  onQuoted?: () => void
  onCopy?: (markdown: string) => void
  onOpenLink?: (href: string) => void
  // Expand in the tab, collapse when expanded.
  onToggleExpanded?: () => void
  autoFocus?: boolean
  className?: string
  ref?: Ref<NotesPanelHandle>
}

// The note of a recording: the format bar with the player's time over the editor, and
// Copy notes and the way to expand or collapse it, in the row of the tabs when it has one. It saves itself, so there is no Save.
export function NotesPanel({
  mode = 'tab', title, content, candidates, mentionChanges, changesFromElsewhere, findSpeaker, time, timeDisabled = false, onSeek, onChange, quotes, onQuoted, onCopy, onOpenLink, onToggleExpanded, autoFocus, className, ref,
}: NotesPanelProps) {
  const editor = useRef<NoteEditorHandle>(null)
  const [tiptap, setTiptap] = useState<Editor | null>(null)
  const [empty, setEmpty] = useState(() => isEmptyNote(content))
  const { area, scrollRef, top, bottom } = useScrollEdges()
  const now = useRef(time)
  now.current = timeDisabled ? undefined : time

  useImperativeHandle(ref, () => ({
    insertQuotes: quotes => editor.current?.insertQuotes(quotes),
    type: text => editor.current?.type(text),
  }), [])

  const insertTime = useCallback(() => {
    if (now.current !== undefined) editor.current?.insertTimecode(Math.floor(now.current))
  }, [])
  const change = useCallback((doc: JSONContent) => {
    setEmpty(isEmptyNote(doc))
    onChange?.(doc)
  }, [onChange])
  const copy = () => {
    const doc = editor.current?.getJSON()
    if (doc) onCopy?.(noteMarkdown(doc, id => findSpeaker(id)))
  }

  const expanded = mode === 'expanded'
  const tabRow = useContext(InspectorActions)
  const inTabRow = !expanded && tabRow !== null
  const placement = inTabRow ? 'below' : 'above'
  const actions = (
    <>
      <Tooltip text="Copy notes" placement={placement}>
        <IconButton icon="copy" size="small" label="Copy notes" disabled={empty} onClick={copy} />
      </Tooltip>
      <Tooltip text={expanded ? 'Collapse notes' : 'Expand notes'} placement={placement}>
        <IconButton icon={expanded ? 'collapse' : 'expand'} size="small" label={expanded ? 'Collapse notes' : 'Expand notes'} onClick={onToggleExpanded} />
      </Tooltip>
    </>
  )
  return (
    <div className={cx(styles.panel, styles[mode], className)}>
      {inTabRow
        ? createPortal(<TooltipGroup group={tabRow.tooltips}><Inline gap={1}>{actions}</Inline></TooltipGroup>, tabRow.element)
        : (
          <TooltipGroup>
            <Inline gap={1} className={styles.header}>
              {expanded && (
                <Inline gap={2} className={styles.heading}>
                  <span className={styles.title}>Notes</span>
                  {title && <span className={styles.recording}>{title}</span>}
                </Inline>
              )}
              <span className={styles.spacer} />
              {actions}
            </Inline>
          </TooltipGroup>
        )}
      <NoteFormatBar editor={tiptap} onInsertTime={time !== undefined ? insertTime : undefined} timeDisabled={timeDisabled} className={styles.formatBar} />
      <div className={styles.scrollArea}>
        <div ref={scrollRef} className={styles.scroll}>
          <div className={styles.column}>
            <NoteEditor
              ref={editor}
              content={content}
              candidates={candidates}
              mentionChanges={mentionChanges}
              changesFromElsewhere={changesFromElsewhere}
              findSpeaker={findSpeaker}
              onSeek={onSeek}
              onChange={change}
              onEditor={setTiptap}
              quotes={quotes}
              onQuoted={onQuoted}
              onOpenLink={onOpenLink}
              size={mode}
              autoFocus={autoFocus}
            />
          </div>
        </div>
        <ScrollBar area={area} />
        {top && <ScrollFade edge="top" />}
        {bottom && <ScrollFade edge="bottom" />}
      </div>
    </div>
  )
}
