import { cx } from '../../styles/cx'
import live from '../../styles/live.module.css'
import { IconButton } from '../IconButton/IconButton'
import { Tooltip } from '../Tooltip/Tooltip'
import styles from './LiveRecordingRow.module.css'

export type LiveRecordingPhase = 'starting' | 'live' | 'stopping'

interface LiveRecordingRowProps {
  title: string
  phase: LiveRecordingPhase
  // The time recorded so far, shown while live.
  elapsed: string
  onStop: () => void
}

const WAITING: Record<Exclude<LiveRecordingPhase, 'live'>, string> = { starting: 'Starting', stopping: 'Stopping' }

// The recording in progress, as a row of the recordings list: a live dot where a new
// recording has its dot, the title, the time. Stop comes in under the pointer or the
// focus; the row itself does nothing.
export function LiveRecordingRow({ title, phase, elapsed, onStop }: LiveRecordingRowProps) {
  const isLive = phase === 'live'
  return (
    <div className={cx(styles.liveRecordingRow, !isLive && styles.waiting)}>
      <span className={styles.status}>
        <span role="img" aria-label={isLive ? 'Recording' : WAITING[phase]} className={cx(live.liveDot, !isLive && live.waiting)} />
      </span>
      <span className={styles.title}>{title}</span>
      <span className={styles.time} aria-live="off">{isLive ? elapsed : WAITING[phase]}</span>
      {isLive && (
        <span className={styles.actions}>
          <Tooltip text="Stop recording" placement="below">
            <IconButton variant="ghost" size="xs" icon="stop" label="Stop recording" className={styles.stop} onClick={onStop} />
          </Tooltip>
        </span>
      )}
    </div>
  )
}
