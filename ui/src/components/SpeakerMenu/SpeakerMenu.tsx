import * as Popover from '@radix-ui/react-popover'
import { useEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent } from 'react'
import { cx } from '../../styles/cx'
import { speakerColor } from '../../styles/speaker-colors'
import { Avatar } from '../Avatar/Avatar'
import { MenuSurface } from '../Menu/Menu'
import { MenuItem } from '../MenuItem/MenuItem'
import { SearchField } from '../SearchField/SearchField'
import { SectionHeader } from '../SectionHeader/SectionHeader'
import styles from './SpeakerMenu.module.css'

export interface SpeakerMenuRow {
  id: string
  name: string
  colorIndex: number
  current: boolean
  time?: string
  usage?: string
}

interface SpeakerMenuProps {
  // The element it opens at. One menu serves a whole list, so it is not a child of the row.
  anchor: HTMLElement
  // What to offer for the text in the search field.
  rows: (query: string) => { section: string | null; rows: SpeakerMenuRow[] }
  allSpeakers: number
  onSelect: (speakerId: string) => void
  onShowAll?: () => void
  // For a control that is not available yet.
  showAllProps?: HTMLAttributes<HTMLButtonElement>
  onClose: () => void
}

const OFFSET = 4

// The focus stays in the search field, and the arrow keys move a highlight over the rows.
export function SpeakerMenu({ anchor, rows: rowsFor, allSpeakers, onSelect, onShowAll, showAllProps, onClose }: SpeakerMenuProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const showAll = useRef<HTMLButtonElement>(null)
  const { section, rows } = rowsFor(query)

  useEffect(() => {
    list.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (row: SpeakerMenuRow) => {
    if (row.current) onClose()
    else onSelect(row.id)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const last = rows.length // the row after the speakers is Show all speakers
      setActive(current => (event.key === 'ArrowDown' ? Math.min(current + 1, last) : Math.max(current - 1, 0)))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (active < rows.length) choose(rows[active])
      else showAll.current?.click()
    }
  }

  return (
    <Popover.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Popover.Anchor virtualRef={{ current: anchor }} />
      <Popover.Portal>
        <Popover.Content
          asChild
          align="start"
          sideOffset={OFFSET}
          collisionPadding={OFFSET}
          aria-label="Change speaker"
          onCloseAutoFocus={event => {
            event.preventDefault()
            anchor.focus()
          }}
        >
          <MenuSurface className={styles.menu} onKeyDown={onKeyDown}>
            <SearchField
              autoFocus
              placeholder="Search speakers"
              aria-label="Search speakers"
              aria-controls="speaker-menu-list"
              aria-activedescendant={active < rows.length ? `speaker-menu-${rows[active].id}` : undefined}
              value={query}
              onValueChange={value => {
                setQuery(value)
                setActive(0)
              }}
            />
            {section && <SectionHeader title={section} />}
            <div ref={list} id="speaker-menu-list" role="listbox" aria-label="Speakers" className={styles.list}>
              {rows.map((row, index) => (
                <div
                  key={row.id}
                  id={`speaker-menu-${row.id}`}
                  role="option"
                  aria-selected={row.current}
                  data-active={index === active ? '' : undefined}
                  className={cx(styles.row, row.current && styles.current, index === active && styles.active)}
                  onPointerMove={() => setActive(index)}
                  onClick={() => choose(row)}
                >
                  <Avatar size="small" name={row.name} color={speakerColor(row.colorIndex)} />
                  <span className={styles.who}>
                    <span className={styles.name}>{row.name}</span>
                    {row.usage && <span className={styles.usage}>{row.usage}</span>}
                  </span>
                  {row.time && <span className={styles.time}>{row.time}</span>}
                </div>
              ))}
              {rows.length === 0 && <span className={styles.empty}>No speakers match “{query.trim()}”</span>}
            </div>
            <div className={styles.divider} />
            <MenuItem
              ref={showAll}
              icon="speakers"
              meta={String(allSpeakers)}
              data-active={active === rows.length ? '' : undefined}
              className={cx(active === rows.length && styles.active)}
              onPointerMove={() => setActive(rows.length)}
              onClick={onShowAll}
              {...showAllProps}
            >
              Show all speakers
            </MenuItem>
          </MenuSurface>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
