import { LiveRecordingRow } from '../components/LiveRecordingRow/LiveRecordingRow'
import { RecordingPill } from '../components/RecordingPill/RecordingPill'
import { SectionHeader } from '../components/SectionHeader/SectionHeader'
import { Stack } from '../components/Stack/Stack'
import { useElapsedSeconds, useRecording } from './RecordingProvider'
import { formatElapsed } from './sources'
import styles from './LiveRecording.module.css'

// The recording in progress above the queue in the sidebar; nothing without one.
export function LiveRecordingSection() {
  const { phase, title, startedAt, stop } = useRecording()
  const elapsed = formatElapsed(useElapsedSeconds(startedAt))
  if (phase === 'idle') return null
  return (
    <Stack as="section" aria-label="Recording" gap="half" paddingBottom={3} align="stretch" className={styles.section}>
      <SectionHeader title="Recording" />
      <LiveRecordingRow title={title} phase={phase} elapsed={elapsed} onStop={stop} />
    </Stack>
  )
}

// The same recording in the title bar, for when the sidebar is hidden.
export function LiveRecordingPill() {
  const { phase, startedAt, stop } = useRecording()
  const elapsed = formatElapsed(useElapsedSeconds(startedAt))
  if (phase === 'idle') return null
  return <RecordingPill phase={phase} elapsed={elapsed} onStop={stop} />
}
