import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import { AvatarStack, type StackSpeaker } from '../AvatarStack/AvatarStack'
import styles from './RecordingRow.module.css'

interface RecordingRowProps extends Omit<ComponentPropsWithRef<'button'>, 'title' | 'children'> {
  title: string
  speakers?: StackSpeaker[]
  // Not opened yet.
  isNew?: boolean
  selected?: boolean
}

const MAX_AVATARS = 3

export function RecordingRow({ title, speakers = [], isNew, selected, type = 'button', className, ...props }: RecordingRowProps) {
  return (
    <button type={type} aria-current={selected ? 'true' : undefined} className={cx(styles.recordingRow, selected && styles.selected, className)} {...props}>
      <span className={styles.status}>
        {isNew && <span role="img" aria-label="New" className={styles.dot} />}
      </span>
      <span className={styles.title}>{title}</span>
      {speakers.length > 0 && <AvatarStack speakers={speakers.slice(0, MAX_AVATARS)} size="small" className={styles.speakers} />}
    </button>
  )
}
