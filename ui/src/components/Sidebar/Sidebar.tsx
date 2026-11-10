import { useRef, useState, type ReactNode } from 'react'
import { cx } from '../../styles/cx'
import type { StackSpeaker } from '../AvatarStack/AvatarStack'
import { Button } from '../Button/Button'
import { ContextMenu } from '../Menu/Menu'
import { RecordingRow } from '../RecordingRow/RecordingRow'
import { ScrollBar } from '../ScrollBar/ScrollBar'
import { ScrollFade, useScrollEdges } from '../ScrollFade/ScrollFade'
import { SectionHeader } from '../SectionHeader/SectionHeader'
import { Stack } from '../Stack/Stack'
import styles from './Sidebar.module.css'

export interface SidebarRecording {
  id: number
  title: string
  speakers: StackSpeaker[]
  isNew: boolean
}

export interface SidebarSection {
  title: string
  recordings: SidebarRecording[]
}

interface SidebarProps {
  state?: 'loading' | 'error' | 'ready'
  sections?: SidebarSection[]
  selectedId?: number | null
  onSelect?: (id: number) => void
  onRetry?: () => void
  // Above the list, such as the recording in progress and the transcription queue.
  // It takes up to 40 % of the height, and what it holds scrolls inside; nothing is
  // reserved for it when it renders nothing. Its sections pad their own sides, so a
  // scroll bar of theirs can stand at the sidebar's edge.
  top?: ReactNode
  // The items of a row's menu, opened by a right click, the Menu key or Shift+F10.
  rowMenu?: (recording: SidebarRecording) => ReactNode
  // The recording whose title is a field, and what was typed in it (null: cancelled).
  renamingId?: number | null
  onRenameDone?: (id: number, next: string | null) => void
  className?: string
}

// The list of recordings. A section with nothing in it is not passed at all.
export function Sidebar({ state = 'ready', sections = [], selectedId, onSelect, onRetry, top, rowMenu, renamingId = null, onRenameDone, className }: SidebarProps) {
  const { area, scrollRef, bottom } = useScrollEdges()
  const [menuOf, setMenuOf] = useState<number | null>(null)
  const rows = useRef(new Map<number, HTMLButtonElement>())

  // The focus goes back to the row unless it already went somewhere else.
  const renameDone = (id: number, next: string | null) => {
    onRenameDone?.(id, next)
    requestAnimationFrame(() => { if (document.activeElement === document.body) rows.current.get(id)?.focus() })
  }

  const recordingRow = (recording: SidebarRecording) => {
    const { id, title, speakers, isNew } = recording
    const row = (
      <RecordingRow
        ref={(element: HTMLButtonElement | null) => {
          if (element) rows.current.set(id, element)
          else rows.current.delete(id)
        }}
        title={title}
        speakers={speakers}
        isNew={isNew}
        selected={id === selectedId}
        menuOpen={menuOf === id}
        renaming={id === renamingId}
        onRenameDone={next => renameDone(id, next)}
        onClick={() => onSelect?.(id)}
      />
    )
    if (!rowMenu) return row
    return (
      // Kept while the title is a field, so a menu closing as Rename is chosen is not
      // taken away in the middle; the field has the browser's menu for its text.
      <ContextMenu
        disabled={id === renamingId}
        content={rowMenu(recording)}
        onOpenChange={open => setMenuOf(current => (open ? id : current === id ? null : current))}
        // An item that put a field or a dialog in front keeps the focus there.
        onCloseAutoFocus={event => { if (document.activeElement && document.activeElement !== document.body) event.preventDefault() }}
      >
        {row}
      </ContextMenu>
    )
  }

  return (
    <div className={cx(styles.sidebar, className)}>
      {top && <Stack paddingTop={3} className={styles.top}>{top}</Stack>}
      <div className={styles.listArea}>
        <div ref={scrollRef} className={styles.scroll}>
          {state === 'error' && (
            <Stack gap={2} align="start" paddingX={2}>
              <span className={styles.message}>Could not load recordings</span>
              <Button variant="secondary" size="small" onClick={onRetry}>Retry</Button>
            </Stack>
          )}
          {state === 'ready' && sections.length === 0 && (
            <Stack paddingX={2}><span className={styles.message}>No recordings yet</span></Stack>
          )}
          {state === 'ready' && sections.map(section => (
            <section key={section.title} aria-label={section.title} className={styles.section}>
              <SectionHeader title={section.title} />
              <Stack as="ul" gap="half" align="stretch" className={styles.list}>
                {section.recordings.map(recording => <li key={recording.id}>{recordingRow(recording)}</li>)}
              </Stack>
            </section>
          ))}
        </div>
        <ScrollBar area={area} />
        {bottom && <ScrollFade edge="bottom" surface="sunken" size="lg" />}
      </div>
    </div>
  )
}
