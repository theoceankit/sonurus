import { useEffect, useRef, type ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import { Avatar } from '../Avatar/Avatar'
import { Icon } from '../Icon/Icon'
import type { MentionOption, MentionSection } from './mention-list'
import styles from './MentionList.module.css'

type MentionListProps = Omit<ComponentPropsWithRef<'div'>, 'children' | 'onSelect'> & {
  sections: MentionSection[]
  // The option the arrow keys stand on, counted over all the sections.
  active: number
  onSelect: (option: MentionOption) => void
  onHover?: (index: number) => void
}

// What @ offers in a note. The focus stays in the note: the arrow keys and Enter
// reach this list through the editor, so its rows are not focusable.
export function MentionList({ sections, active, onSelect, onHover, className, ...props }: MentionListProps) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [active])
  let index = 0
  return (
    <div ref={list} role="listbox" aria-label="Mention" data-state="open" className={cx(styles.surface, className)} {...props}>
      {sections.map(section => (
        <div key={section.title || 'typed'} role="group" aria-label={section.title || undefined} className={cx(styles.section, !section.title && styles.typed)}>
          {section.title && <div className={styles.heading}>{section.title}</div>}
          {section.options.map(option => {
            const at = index++
            const current = at === active
            return (
              <div
                key={option.kind === 'speaker' ? option.speaker.id : `person:${option.name}`}
                role="option"
                aria-selected={current}
                data-active={current ? '' : undefined}
                className={cx(styles.option, current && styles.active)}
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => onHover?.(at)}
                onClick={() => onSelect(option)}
              >
                {option.kind === 'speaker'
                  ? (
                      <>
                        <Avatar name={option.speaker.name} color={option.speaker.color} photo={option.speaker.photo} size="small" />
                        <span className={styles.label}>{option.speaker.name}</span>
                        {option.speaker.handle && <span className={styles.meta}>@{option.speaker.handle}</span>}
                      </>
                    )
                  : (
                      <>
                        <Icon name="add" className={styles.leading} />
                        <span className={styles.label}>Mention "{option.name}"</span>
                      </>
                    )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
