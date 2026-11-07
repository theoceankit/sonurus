import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { cx } from '../../styles/cx'
import live from '../../styles/live.module.css'
import { Icon } from '../Icon/Icon'
import { Menu, MenuAction } from '../Menu/Menu'
import type { LiveRecordingPhase } from '../LiveRecordingRow/LiveRecordingRow'
import styles from './RecordingPill.module.css'

interface RecordingPillProps {
  phase: LiveRecordingPhase
  elapsed: string
  onStop: () => void
}

const WAITING = { starting: 'Starting', stopping: 'Stopping' } as const

type PillProps = ComponentPropsWithoutRef<'button'> & { phase: LiveRecordingPhase; elapsed: string }

// Menu's trigger needs the ref and the handlers it hands down.
const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill({ phase, elapsed, className, ...props }, ref) {
  const isLive = phase === 'live'
  return (
    <button ref={ref} type="button" className={cx(styles.recordingPill, !isLive && styles.waiting, className)} disabled={!isLive} {...props}>
      <span className={cx(live.liveDot, !isLive && live.waiting)} />
      <span className={styles.time}>{isLive ? elapsed : WAITING[phase]}</span>
      {isLive && <Icon name="chevron-down" size={12} />}
    </button>
  )
})

// The recording in progress in the title bar, while the sidebar that shows its row is
// hidden. The arrow opens a menu that stops it; starting and stopping only show.
export function RecordingPill({ phase, elapsed, onStop }: RecordingPillProps) {
  if (phase !== 'live') return <Pill phase={phase} elapsed={elapsed} aria-label={WAITING[phase]} />
  return (
    <Menu align="end" trigger={<Pill phase={phase} elapsed={elapsed} aria-label={`Recording ${elapsed}`} />}>
      <MenuAction icon="stop" onSelect={onStop}>Stop recording</MenuAction>
    </Menu>
  )
}
