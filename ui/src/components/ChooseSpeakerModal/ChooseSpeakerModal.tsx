import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { markNotImplemented } from '../../not-implemented'
import { speakerColor } from '../../styles/speaker-colors'
import { Button } from '../Button/Button'
import { Candidate } from '../Candidate/Candidate'
import { MenuItem } from '../MenuItem/MenuItem'
import { Modal } from '../Modal/Modal'
import { ModalBody } from '../ModalBody/ModalBody'
import { ModalFooter } from '../ModalFooter/ModalFooter'
import { ModalHeader } from '../ModalHeader/ModalHeader'
import { ScrollBar } from '../ScrollBar/ScrollBar'
import { ScrollFade, useScrollEdges } from '../ScrollFade/ScrollFade'
import { SearchField } from '../SearchField/SearchField'
import { SectionHeader } from '../SectionHeader/SectionHeader'
import styles from './ChooseSpeakerModal.module.css'

export type ChooseSpeakerCategory = 'all' | 'best' | 'recording'

export interface ChooseSpeakerRow {
  id: string
  name: string
  // Under the name: who exactly, when two share a name.
  handle?: string | null
  colorIndex: number
  score?: number
  suggested?: boolean
  usage?: string
}

export interface ChooseSpeakerList {
  counts: Record<ChooseSpeakerCategory, number>
  sections: { title: string; rows: ChooseSpeakerRow[] }[]
}

interface ChooseSpeakerModalProps {
  // What to offer for the text in the search field and the category.
  list: (query: string, category: ChooseSpeakerCategory) => ChooseSpeakerList
  initialSelectedId?: string | null
  onAssign: (id: string) => void
  // With what was typed in the search field, for its name.
  onNewSpeaker: (name: string) => void
  onClose: () => void
  open?: boolean
  onExited?: () => void
  skipEnter?: boolean
  busy?: boolean
  // For a story: the search without typing, and the window in place.
  initialQuery?: string
  preview?: boolean
}

const CATEGORIES: { id: ChooseSpeakerCategory; label: string; icon: 'speakers' | 'waveform' | 'microphone' }[] = [
  { id: 'all', label: 'All speakers', icon: 'speakers' },
  { id: 'best', label: 'Best voice matches', icon: 'waveform' },
  { id: 'recording', label: 'Already in this recording', icon: 'microphone' },
]

export function ChooseSpeakerModal({ list, initialSelectedId = null, onAssign, onNewSpeaker, onClose, open = true, onExited, skipEnter, busy, initialQuery = '', preview }: ChooseSpeakerModalProps) {
  const [query, setQuery] = useState(initialQuery)
  const [category, setCategory] = useState<ChooseSpeakerCategory>('all')
  const [selectedId, setSelectedId] = useState(initialSelectedId)
  const scroll = useRef<HTMLDivElement>(null)
  const { area, scrollRef, bottom } = useScrollEdges()

  const { counts, sections } = list(query, category)
  const rows = sections.flatMap(section => section.rows)
  const typed = query.trim()
  const chosen = rows.some(row => row.id === selectedId) ? selectedId : null

  useEffect(() => {
    scroll.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [chosen])

  const search = (value: string) => {
    setQuery(value)
    // Enter after typing takes the first result.
    if (value.trim() !== '') {
      const found = list(value, category).sections.flatMap(section => section.rows)
      if (!found.some(row => row.id === selectedId)) setSelectedId(found[0]?.id ?? null)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (rows.length === 0) return
      event.preventDefault()
      const at = rows.findIndex(row => row.id === chosen)
      const next = event.key === 'ArrowDown' ? Math.min(at + 1, rows.length - 1) : Math.max(at - 1, 0)
      setSelectedId(rows[next].id)
    } else if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
      event.preventDefault()
      if (chosen) onAssign(chosen)
      else if (rows.length === 0 && typed) onNewSpeaker(typed)
    }
  }

  const categoryItem = ({ id, label, icon }: typeof CATEGORIES[number]) => (
    <MenuItem key={id} icon={icon} meta={String(counts[id])} current={category === id} onClick={() => setCategory(id)}>{label}</MenuItem>
  )

  return (
    <Modal size="large" open={open} onExited={onExited} skipEnter={skipEnter} preview={preview} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title="Choose a speaker" />
      <ModalBody className={styles.body} onKeyDown={onKeyDown}>
        <nav aria-label="Categories" className={styles.rail}>
          {CATEGORIES.slice(0, 2).map(categoryItem)}
          <MenuItem icon="calendar" {...markNotImplemented('choose-speaker.invited')}>Invited to this meeting</MenuItem>
          {CATEGORIES.slice(2).map(categoryItem)}
          <MenuItem icon="clock" {...markNotImplemented('choose-speaker.recently-added')}>Recently added</MenuItem>
        </nav>
        <div className={styles.results}>
          <SearchField
            data-modal-start
            placeholder="Search speakers"
            aria-label="Search speakers"
            value={query}
            onValueChange={search}
          />
          <div className={styles.listArea}>
            <div
              ref={node => { scroll.current = node; scrollRef(node) }}
              role="listbox"
              aria-label="Speakers"
              className={styles.list}
            >
              {sections.map(section => (
                <div key={section.title} role="group" aria-label={section.title} className={styles.section}>
                  <SectionHeader title={section.title} />
                  {section.rows.map(row => (
                    <Candidate
                      key={row.id}
                      role="option"
                      aria-selected={row.id === chosen}
                      tabIndex={-1}
                      speaker={{ name: row.name, color: speakerColor(row.colorIndex) }}
                      handle={row.handle}
                      score={row.score}
                      suggested={row.suggested}
                      usage={row.usage}
                      selected={row.id === chosen}
                      onClick={() => setSelectedId(row.id)}
                      onDoubleClick={() => onAssign(row.id)}
                    />
                  ))}
                </div>
              ))}
              {rows.length === 0 && typed && (
                <div className={styles.section}>
                  <SectionHeader title={`No speakers match "${typed}"`} />
                  <Candidate kind="add" active onClick={() => onNewSpeaker(typed)}>Add &quot;{typed}&quot; as a new speaker</Candidate>
                </div>
              )}
              {rows.length === 0 && !typed && <SectionHeader title="No speakers here yet" />}
            </div>
            <ScrollBar area={area} />
            {bottom && <ScrollFade edge="bottom" surface="raised" />}
          </div>
        </div>
      </ModalBody>
      <ModalFooter
        leading={<Button variant="ghost" icon="add" onClick={() => onNewSpeaker(typed)}>New speaker</Button>}
        confirm={{ children: 'Assign', disabled: !chosen, loading: busy, onClick: () => { if (chosen) onAssign(chosen) } }}
      />
    </Modal>
  )
}
