import type { ComponentPropsWithRef, MouseEventHandler, ReactNode } from 'react'
import { cx } from '../../styles/cx'
import shimmer from '../../styles/shimmer.module.css'
import styles from './QueueRow.module.css'

export type QueueRowStatus = 'waiting' | 'running' | 'failed'

interface QueueRowProps extends Omit<ComponentPropsWithRef<'div'>, 'title' | 'children' | 'onClick'> {
  title: string
  status: QueueRowStatus
  // Buttons at the end of the row while the pointer is over it, the focus is in it
  // or a menu of theirs is open.
  actions?: ReactNode
  selected?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
  // While a row is dragged over this one: where it would land.
  drop?: 'before' | 'after' | null
  dragging?: boolean
}

const STATUS_LABEL: Record<QueueRowStatus, string | null> = { waiting: null, running: 'Transcribing', failed: 'Failed' }

// A job of the transcription queue, as a row of the recordings list: the same height,
// title and status slot. Jobs not transcribed, waiting or failed, are paler; a
// glint now and then crosses the title of the running job; a failed one has a dot.
export function QueueRow({ title, status, actions, selected, onClick, drop, dragging, className, ...props }: QueueRowProps) {
  const label = STATUS_LABEL[status]
  return (
    <div
      className={cx(styles.queueRow, selected && styles.selected, dragging && styles.dragging, className)}
      {...props}
    >
      {drop && <span className={styles.dropLine} data-place={drop} aria-hidden />}
      <button type="button" aria-current={selected ? 'true' : undefined} className={styles.row} onClick={onClick}>
        <span className={styles.status}>
          {status === 'running' && <span role="img" aria-label={label!} />}
          {status === 'failed' && <span role="img" aria-label={label!} className={styles.dot} />}
        </span>
        <span className={cx(styles.title, status !== 'running' && styles.pale, status === 'running' && shimmer.shimmer)}>{title}</span>
      </button>
      {actions != null && <span className={styles.actions} data-row-actions>{actions}</span>}
    </div>
  )
}
