import type { JSONContent } from '@tiptap/react'
import { useCallback, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { formatClock } from '../../media/timeline'
import { currentOs } from '../../platform/os'
import { cx } from '../../styles/cx'
import { Button } from '../Button/Button'
import { IconButton } from '../IconButton/IconButton'
import { Inline } from '../Inline/Inline'
import type { MentionCandidate } from '../MentionList/mention-list'
import { isEmptyNote, type NoteQuote } from '../NoteEditor/note-content'
import type { FindSpeaker } from '../NoteEditor/note-extensions'
import { noteMarkdown } from '../NoteEditor/note-markdown'
import { NoteEditor, type NoteEditorHandle } from '../NoteEditor/NoteEditor'
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
  findSpeaker: FindSpeaker
  // Where the player stands, to the second: what the time button inserts. Without
  // it there is no time button.
  time?: number
  onSeek?: (seconds: number) => void
  onChange?: (doc: JSONContent) => void
  onCopy?: (markdown: string) => void
  onOpenLink?: (href: string) => void
  // Expand in the tab, collapse when expanded.
  onToggleExpanded?: () => void
  autoFocus?: boolean
  className?: string
  ref?: Ref<NotesPanelHandle>
}

const shortcut = () => (currentOs() === 'mac' ? '⌘T' : 'Ctrl T')

// The note of a recording: the player's time, Copy notes and the way to expand or
// collapse it over the editor. It saves itself, so there is no Save.
export function NotesPanel({
  mode = 'tab', title, content, candidates, findSpeaker, time, onSeek, onChange, onCopy, onOpenLink, onToggleExpanded, autoFocus, className, ref,
}: NotesPanelProps) {
  const editor = useRef<NoteEditorHandle>(null)
  const [empty, setEmpty] = useState(() => isEmptyNote(content))
  const { area, scrollRef, top, bottom } = useScrollEdges()
  const now = useRef(time)
  now.current = time

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
  return (
    <div className={cx(styles.panel, styles[mode], className)}>
      <TooltipGroup>
        <Inline gap={1} className={styles.header}>
          {expanded && (
            <Inline gap={2} className={styles.heading}>
              <span className={styles.title}>Notes</span>
              {title && <span className={styles.recording}>{title}</span>}
            </Inline>
          )}
          {time !== undefined && (
            <Tooltip text={`Insert player time, ${shortcut()}`}>
              <Button variant="ghost" size="small" icon="clock" aria-label="Insert player time" onMouseDown={event => event.preventDefault()} onClick={insertTime}>
                {formatClock(time)}
              </Button>
            </Tooltip>
          )}
          <span className={styles.spacer} />
          <Tooltip text="Copy notes">
            <IconButton icon="copy" size="small" label="Copy notes" disabled={empty} onClick={copy} />
          </Tooltip>
          <Tooltip text={expanded ? 'Collapse notes' : 'Expand notes'}>
            <IconButton icon={expanded ? 'collapse' : 'expand'} size="small" label={expanded ? 'Collapse notes' : 'Expand notes'} onClick={onToggleExpanded} />
          </Tooltip>
        </Inline>
      </TooltipGroup>
      <div className={styles.scrollArea}>
        <div ref={scrollRef} className={styles.scroll}>
          <div className={styles.column}>
            <NoteEditor
              ref={editor}
              content={content}
              candidates={candidates}
              findSpeaker={findSpeaker}
              onSeek={onSeek}
              onChange={change}
              onTimeShortcut={time === undefined ? undefined : insertTime}
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
