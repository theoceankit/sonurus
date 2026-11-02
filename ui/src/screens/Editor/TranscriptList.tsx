import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import type { Segment } from '../../api/types'
import { Paragraph } from '../../components/Paragraph/Paragraph'
import { TurnHeader } from '../../components/TurnHeader/TurnHeader'
import { useIsKey, type KeyStore } from '../../media/active-segment'
import { formatClock } from '../../media/timeline'
import type { SpeakerColor } from '../../styles/speaker-colors'
import type { TranscriptTurn, TurnSpeaker } from './transcript'
import styles from './TranscriptPanel.module.css'

export type MenuKey = `turn:${number}` | `segment:${number}` | null

// What every row needs and never changes. Rows find out what concerns them from the
// stores, so one change renders the rows it is about and not the list.
export interface TranscriptRows {
  playing: KeyStore<number | null>
  editing: KeyStore<number | null>
  menu: KeyStore<MenuKey>
  seek: (start: number) => void
  play: (start: number) => void
  copy: (text: string) => void
  save: (start: number, text: string) => void
  remove: (start: number) => void
  openTurnMenu: (anchor: HTMLElement, turn: TranscriptTurn) => void
  openSegmentMenu: (anchor: HTMLElement, segment: Segment, speaker: TurnSpeaker) => void
}

const Rows = createContext<TranscriptRows | null>(null)

interface ParagraphRowProps {
  segment: Segment
  speaker: TurnSpeaker
  color: SpeakerColor
}

const ParagraphRow = memo(function ParagraphRow({ segment, speaker, color }: ParagraphRowProps) {
  const rows = useContext(Rows)!
  const { start, text } = segment
  const playing = useIsKey(rows.playing, start)
  const editing = useIsKey(rows.editing, start)
  const menuOpen = useIsKey(rows.menu, `segment:${start}`)
  const root = useRef<HTMLDivElement>(null)
  const wasEditing = useRef(false)

  // Ending an edit with the keyboard leaves the focus nowhere.
  useEffect(() => {
    if (wasEditing.current && !editing && document.activeElement === document.body) root.current?.focus()
    wasEditing.current = editing
  }, [editing])

  return (
    <Paragraph
      ref={root}
      text={text}
      color={color}
      playing={playing}
      editing={editing}
      showActions={menuOpen}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) {
          event.preventDefault()
          rows.editing.set(start)
        }
      }}
      onPlay={() => rows.play(start)}
      onEdit={() => rows.editing.set(start)}
      onCopy={() => rows.copy(text)}
      onChangeSpeaker={anchor => rows.openSegmentMenu(anchor, segment, speaker)}
      onDelete={() => rows.remove(start)}
      onSave={next => {
        rows.editing.set(null)
        rows.save(start, next)
      }}
      onCancel={() => rows.editing.set(null)}
    />
  )
})

const sameTurn = ({ turn: a }: { turn: TranscriptTurn }, { turn: b }: { turn: TranscriptTurn }) =>
  a.start === b.start
  && a.speaker.id === b.speaker.id
  && a.speaker.name === b.speaker.name
  && a.speaker.color === b.speaker.color
  && a.segments.length === b.segments.length
  && a.segments.every((segment, i) => segment === b.segments[i])

const TurnRow = memo(function TurnRow({ turn }: { turn: TranscriptTurn }) {
  const rows = useContext(Rows)!
  const open = useIsKey(rows.menu, `turn:${turn.start}`)
  return (
    <div className={styles.turn}>
      <TurnHeader
        speaker={turn.speaker}
        time={formatClock(turn.start)}
        open={open}
        onOpenMenu={anchor => rows.openTurnMenu(anchor, turn)}
        onSeek={() => rows.seek(turn.start)}
      />
      {turn.segments.map(segment => <ParagraphRow key={segment.start} segment={segment} speaker={turn.speaker} color={turn.speaker.color} />)}
    </div>
  )
}, sameTurn)

// The first row inside the scroll area. Rows are in order, so a binary search does it.
function firstVisible(items: readonly HTMLElement[], top: number) {
  let lo = 0
  let hi = items.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (items[mid].getBoundingClientRect().bottom >= top) hi = mid
    else lo = mid + 1
  }
  return items[lo]
}

const navItems = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>('[data-nav]')]

interface TranscriptListProps {
  turns: readonly TranscriptTurn[]
  rows: TranscriptRows
}

// One stop of Tab for the whole list: Tab lands on the list, which hands the focus to
// the row it was last on or the first in view, and the arrow keys go on from there.
export const TranscriptList = memo(function TranscriptList({ turns, rows }: TranscriptListProps) {
  const list = useRef<HTMLDivElement>(null)
  const last = useRef<HTMLElement | null>(null)
  const [inside, setInside] = useState(false)

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const node = list.current!
    if (event.target !== node) {
      if (event.target.hasAttribute('data-nav')) last.current = event.target
      setInside(true)
      return
    }
    const items = navItems(node)
    if (!items.length) return
    const scrollTop = node.closest('[data-transcript-scroll]')!.getBoundingClientRect().top
    const target = last.current?.isConnected ? last.current : firstVisible(items, scrollTop)
    target.focus()
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!list.current!.contains(event.relatedTarget)) setInside(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const target = event.target as HTMLElement
    if (!target.hasAttribute('data-nav')) return
    event.preventDefault()
    const items = navItems(list.current!)
    items[items.indexOf(target) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus()
  }

  const content = useMemo(() => turns.map(turn => <TurnRow key={turn.start} turn={turn} />), [turns])

  return (
    <Rows.Provider value={rows}>
      <div
        ref={list}
        data-transcript-list=""
        aria-label="Transcript text"
        role="group"
        tabIndex={inside ? -1 : 0}
        className={styles.list}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        {content}
      </div>
    </Rows.Provider>
  )
})
