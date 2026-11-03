import { cx } from '../../styles/cx'
import type { StackSpeaker } from '../AvatarStack/AvatarStack'
import { Button } from '../Button/Button'
import { RecordingRow } from '../RecordingRow/RecordingRow'
import { ScrollBar } from '../ScrollBar/ScrollBar'
import { ScrollFade, useScrollEdges } from '../ScrollFade/ScrollFade'
import { SectionHeader } from '../SectionHeader/SectionHeader'
import { Stack } from '../Stack/Stack'
import styles from './Sidebar.module.css'

export interface SidebarRecording {
  id: number
  title: string
  speakers: StackSpeaker[]
  isNew: boolean
}

export interface SidebarSection {
  title: string
  recordings: SidebarRecording[]
}

interface SidebarProps {
  state?: 'loading' | 'error' | 'ready'
  sections?: SidebarSection[]
  selectedId?: number | null
  onSelect?: (id: number) => void
  onRetry?: () => void
  className?: string
}

// The list of recordings. A section with nothing in it is not passed at all.
export function Sidebar({ state = 'ready', sections = [], selectedId, onSelect, onRetry, className }: SidebarProps) {
  const { area, scrollRef, bottom } = useScrollEdges()
  return (
    <div className={cx(styles.sidebar, className)}>
      <div ref={scrollRef} className={styles.scroll}>
        {state === 'error' && (
          <Stack gap={2} align="start" paddingX={2}>
            <span className={styles.message}>Could not load recordings</span>
            <Button variant="secondary" size="small" onClick={onRetry}>Retry</Button>
          </Stack>
        )}
        {state === 'ready' && sections.length === 0 && (
          <Stack paddingX={2}><span className={styles.message}>No recordings yet</span></Stack>
        )}
        {state === 'ready' && sections.map(section => (
          <section key={section.title} aria-label={section.title} className={styles.section}>
            <SectionHeader title={section.title} />
            <Stack as="ul" gap="half" align="stretch" className={styles.list}>
              {section.recordings.map(({ id, title, speakers, isNew }) => (
                <li key={id}>
                  <RecordingRow
                    title={title}
                    speakers={speakers}
                    isNew={isNew}
                    selected={id === selectedId}
                    onClick={() => onSelect?.(id)}
                  />
                </li>
              ))}
            </Stack>
          </section>
        ))}
      </div>
      <ScrollBar area={area} />
      {bottom && <ScrollFade edge="bottom" surface="sunken" size="lg" />}
    </div>
  )
}
