import { useLayoutEffect, useRef, useState, type ComponentPropsWithRef } from 'react'
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

// The width follows the text, and moves. It is read only when the text can have
// changed its width: digits are tabular, so while the time runs nothing is read.
function Bubble({ time, name }: { time?: string; name?: string }) {
  const inner = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState<number>()
  useLayoutEffect(() => { setWidth(inner.current!.offsetWidth) }, [time?.length, name])
  return (
    <span className={styles.bubble} style={{ width }}>
      <span ref={inner} className={styles.bubbleText}>
        <span>{time}</span>
        {name && <span className={styles.name}>{name}</span>}
      </span>
    </span>
  )
}

export function Playhead({ look = 'default', position, time, name, className, style, ...props }: PlayheadProps) {
  return (
    <div className={cx(styles.playhead, styles[look], className)} style={{ left: `${position * 100}%`, ...style }} aria-hidden {...props}>
      <span className={styles.line} />
      {look === 'default'
        ? <span className={styles.knob} />
        : <Bubble time={time} name={name} />}
    </div>
  )
}
