import type { ComponentPropsWithRef } from 'react'
import { formatClock } from '../../media/timeline'
import { cx } from '../../styles/cx'
import { Icon } from '../Icon/Icon'
import styles from './TimecodeChip.module.css'

type TimecodeChipProps = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  seconds: number
  // Selected as a whole in the note, as a node the cursor cannot enter.
  selected?: boolean
}

// A moment of the recording in a note: a click takes the player there.
export function TimecodeChip({ seconds, selected, className, type = 'button', ...props }: TimecodeChipProps) {
  const time = formatClock(seconds)
  return (
    <button
      type={type}
      aria-label={`Go to ${time}`}
      className={cx(styles.chip, selected && styles.selected, className)}
      {...props}
    >
      <Icon name="clock" size={12} className={styles.icon} />
      <span className={styles.time}>{time}</span>
    </button>
  )
}
