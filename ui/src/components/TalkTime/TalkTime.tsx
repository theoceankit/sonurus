import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import type { SpeakerColor } from '../../styles/speaker-colors'
import styles from './TalkTime.module.css'

export interface TalkTimeSegment {
  id: string
  name: string
  color: SpeakerColor
  seconds: number
}

type TalkTimeProps = Omit<ComponentPropsWithRef<'div'>, 'children'> & {
  // 0:53, the sum of everyone's speech.
  total: string
  segments: readonly TalkTimeSegment[]
}

// A segment's width is its share of the speech, as many as there are speakers.
export function TalkTime({ total, segments, className, ...props }: TalkTimeProps) {
  return (
    <div className={cx(styles.talkTime, className)} {...props}>
      <div className={styles.top}>
        <span>Talk time</span>
        <span>{total}</span>
      </div>
      <div className={styles.bar} role="img" aria-label={`Talk time: ${segments.map(segment => segment.name).join(', ')}`}>
        {segments.map(({ id, color, seconds }) => (
          <span
            key={id}
            data-segment
            className={styles.segment}
            style={{ flexGrow: seconds, background: `var(--color-speaker-${color}-mid)` }}
          />
        ))}
      </div>
    </div>
  )
}
