import { useState } from 'react'
import { Button } from '../../components/Button/Button'
import { Icon } from '../../components/Icon/Icon'
import { IconButton } from '../../components/IconButton/IconButton'
import { Inline } from '../../components/Inline/Inline'
import { Menu, MenuAction } from '../../components/Menu/Menu'
import { Reveal } from '../../components/Reveal/Reveal'
import { ScrollBar } from '../../components/ScrollBar/ScrollBar'
import { Stack } from '../../components/Stack/Stack'
import { cx } from '../../styles/cx'
import shimmer from '../../styles/shimmer.module.css'
import styles from './QueueJobView.module.css'

export interface QueueJobViewProps {
  title: string
  status: 'waiting' | 'running' | 'failed'
  // The step, the place in the queue, or what failed.
  statusText: string
  // The whole error of a failed job, as the backend gave it: shown on request.
  error?: string | null
  retrying?: boolean
  onRetry?: () => void
  onEdit?: () => void
  onDelete?: () => void
  // For a story: the log open.
  initialLogOpen?: boolean
}

// The centre of the window for a job picked in the queue, laid out as a transcript's
// header: where a failed job says why once its toast is gone, its log folded as the
// text of a review card is.
export function QueueJobView({ title, status, statusText, error, retrying, onRetry, onEdit, onDelete, initialLogOpen = false }: QueueJobViewProps) {
  const [logOpen, setLogOpen] = useState(initialLogOpen)
  const [log, setLog] = useState<HTMLElement | null>(null)
  const hasLog = status === 'failed' && !!error
  return (
    <Stack gap={2} paddingX={6} paddingY={4} className={styles.queueJobView}>
      <div className={styles.topRow}>
        <Menu align="end" trigger={<IconButton icon="more" label="More" />}>
          <MenuAction icon="delete" onSelect={onDelete}>Delete from queue</MenuAction>
        </Menu>
      </div>
      <Stack gap={4} align="start" className={styles.body}>
        <Stack gap={2} align="start">
          <h1 className={styles.title}>{title}</h1>
          <p className={cx(styles.status, status === 'failed' && styles.failed, status === 'running' && shimmer.shimmer)}>{statusText}</p>
        </Stack>
        {status !== 'running' && (
          <Inline gap={2}>
            {status === 'failed' && <Button variant="primary" icon="retry" loading={retrying} onClick={onRetry}>Retry</Button>}
            <Button variant="secondary" icon="edit" onClick={onEdit}>Transcription settings</Button>
          </Inline>
        )}
        {hasLog && (
          <Stack align="start" className={styles.logArea}>
            <button type="button" className={styles.logToggle} aria-expanded={logOpen} onClick={() => setLogOpen(open => !open)}>
              {logOpen ? 'Hide log' : 'Show log'}
              <Icon name="chevron-down" size={12} className={cx(styles.chevron, logOpen && styles.up)} />
            </button>
            <Reveal open={logOpen} className={styles.logBox}>
              <Stack paddingTop={2} className={styles.logWrap}>
                <pre ref={setLog} className={styles.log}>{error}</pre>
                <ScrollBar area={log} />
              </Stack>
            </Reveal>
          </Stack>
        )}
      </Stack>
    </Stack>
  )
}
