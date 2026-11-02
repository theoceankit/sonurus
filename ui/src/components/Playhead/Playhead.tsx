import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import styles from './Playhead.module.css'

export type PlayheadLook = 'default' | 'hover'

// Draws in the waveform it marks, which is its positioned parent.
type PlayheadProps = Omit<ComponentPropsWithRef<'div'>, 'children'> & {
  look?: PlayheadLook
  // Where it stands, from 0 to 1 of the waveform.
  position: number
  // The bubble of the hover look.
  time?: string
  name?: string
}

export function Playhead({ look = 'default', position, time, name, className, style, ...props }: PlayheadProps) {
  return (
    <div className={cx(styles.playhead, styles[look], className)} style={{ left: `${position * 100}%`, ...style }} aria-hidden {...props}>
      <span className={styles.line} />
      {look === 'default'
        ? <span className={styles.knob} />
        : (
          <span className={styles.bubble}>
            <span>{time}</span>
            {name && <span className={styles.name}>{name}</span>}
          </span>
        )}
    </div>
  )
}
