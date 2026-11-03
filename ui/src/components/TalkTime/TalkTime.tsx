import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { Tooltip } from '../Tooltip/Tooltip'
import styles from './TalkTime.module.css'

export interface TalkTimeSegment {
  id: string
  name: string
  color: SpeakerColor
  seconds: number
  // 0:19, for the tooltip.
  time: string
}

type TalkTimeProps = Omit<ComponentPropsWithRef<'div'>, 'children'> & {
  // 0:53, the sum of everyone's speech.
  total: string
  segments: readonly TalkTimeSegment[]
  // Its segment keeps the middle tone and the others take the light one.
  highlightedId?: string | null
  // The speaker of the segment under the pointer, or null once it has left the bar.
  onHighlight?: (id: string | null) => void
}

// A segment's width is its share of the speech, as many as there are speakers.
export function TalkTime({ total, segments, highlightedId, onHighlight, className, ...props }: TalkTimeProps) {
  const dimmed = segments.some(segment => segment.id === highlightedId)
  return (
    <div className={cx(styles.talkTime, className)} {...props}>
      <div className={styles.top}>
        <span>Talk time</span>
        <span>{total}</span>
      </div>
      <div
        className={styles.bar}
        role="img"
        aria-label={`Talk time: ${segments.map(segment => segment.name).join(', ')}`}
        onPointerLeave={() => onHighlight?.(null)}
      >
        {segments.map(({ id, name, color, seconds, time }) => (
          <Tooltip key={id} text={`${name} ${time}`}>
            <span
              data-segment
              className={styles.segment}
              style={{ flexGrow: seconds, background: `var(--color-speaker-${color}-${dimmed && id !== highlightedId ? 'bg' : 'mid'})` }}
              onPointerEnter={() => onHighlight?.(id)}
            />
          </Tooltip>
        ))}
      </div>
    </div>
  )
}
