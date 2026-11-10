import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../../styles/cx'
import { AvatarStack, type StackSpeaker } from '../AvatarStack/AvatarStack'
import { TitleField } from '../TitleField/TitleField'
import styles from './RecordingRow.module.css'

interface RecordingRowProps extends Omit<ComponentPropsWithRef<'button'>, 'title' | 'children'> {
  title: string
  speakers?: StackSpeaker[]
  // Not opened yet.
  isNew?: boolean
  selected?: boolean
  // A menu of the row is open: it looks as under the pointer.
  menuOpen?: boolean
  // A field with the title stands in place of the button; the dot and the avatars stay.
  renaming?: boolean
  // What was typed, or null when the edit was cancelled. Checking it is up to the caller.
  onRenameDone?: (next: string | null) => void
}

const MAX_AVATARS = 3

export function RecordingRow({ title, speakers = [], isNew, selected, menuOpen, renaming, onRenameDone, type = 'button', className, ...props }: RecordingRowProps) {
  const content = (title: ReactNode) => (
    <>
      <span className={styles.status}>
        {isNew && <span role="img" aria-label="New" className={styles.dot} />}
      </span>
      {title}
      {speakers.length > 0 && <AvatarStack speakers={speakers.slice(0, MAX_AVATARS)} size="small" className={styles.speakers} />}
    </>
  )
  // A field cannot stand inside a button, so the row is a box while it is there.
  if (renaming) {
    return (
      <div className={cx(styles.recordingRow, styles.renaming, selected && styles.selected, className)}>
        {content(<TitleField title={title} label="Recording title" className={styles.input} onDone={next => onRenameDone?.(next)} />)}
      </div>
    )
  }
  return (
    <button
      type={type}
      aria-current={selected ? 'true' : undefined}
      className={cx(styles.recordingRow, selected && styles.selected, menuOpen && styles.menuOpen, className)}
      {...props}
    >
      {content(<span className={styles.title}>{title}</span>)}
    </button>
  )
}
