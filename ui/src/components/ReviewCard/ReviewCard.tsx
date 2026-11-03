import { useState, type ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import { speakerColor } from '../../styles/speaker-colors'
import { Avatar, avatarOf, type LabelledSpeaker } from '../Avatar/Avatar'
import { Button } from '../Button/Button'
import { Candidate } from '../Candidate/Candidate'
import { ClipPlayer } from '../ClipPlayer/ClipPlayer'
import { Collapse } from '../Collapse/Collapse'
import { IconButton } from '../IconButton/IconButton'
import { ScrollBar } from '../ScrollBar/ScrollBar'
import { SectionHeader } from '../SectionHeader/SectionHeader'
import styles from './ReviewCard.module.css'

export interface ReviewCardCandidate {
  id: string
  name: string
  colorIndex: number
  score: number
  suggested: boolean
}

export interface ReviewCardClip {
  duration: string
  text: string
  playing?: boolean
  progress: number
  disabled?: boolean
  onToggle?: () => void
}

type ReviewCardProps = Omit<ComponentPropsWithRef<'section'>, 'children' | 'onSelect'> & {
  speaker: LabelledSpeaker
  // Head = Possible match: a recognized speaker to confirm.
  possibleMatch?: boolean
  // No clip, no player: the audio is gone.
  clip?: ReviewCardClip | null
  candidates: readonly ReviewCardCandidate[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  onSearch?: () => void
  onAddNew?: () => void
  onSkip?: () => void
  onAssign?: () => void
  onClose?: () => void
  // The answer is on its way.
  busy?: boolean
  // For a story.
  initialTextExpanded?: boolean
}

export function ReviewCard({
  speaker, possibleMatch, clip, candidates, selectedId = null, onSelect, onSearch, onAddNew, onSkip, onAssign, onClose, busy, initialTextExpanded = false, className, ...props
}: ReviewCardProps) {
  const [expanded, setExpanded] = useState(initialTextExpanded)
  const [text, setText] = useState<HTMLElement | null>(null)
  return (
    <section aria-label={`Who is ${speaker.name}?`} className={cx(styles.reviewCard, className)} {...props}>
      <div className={styles.head}>
        <Avatar {...avatarOf(speaker)} size="medium" />
        <div className={styles.who}>
          <span className={styles.name}>{speaker.name}</span>
          {possibleMatch && <span className={styles.caption}>Possible match</span>}
        </div>
      </div>
      <IconButton icon="close" size="small" label="Close review" className={styles.close} onClick={onClose} />
      {clip && (
        <div className={styles.clip}>
          <ClipPlayer
            playing={clip.playing}
            progress={clip.progress}
            duration={clip.duration}
            disabled={clip.disabled}
            onToggle={clip.onToggle}
            textExpanded={expanded}
            onToggleText={() => setExpanded(open => !open)}
          />
          <Collapse open={expanded} className={styles.textBox}>
            <p ref={setText} className={styles.text}>{clip.text}</p>
            <ScrollBar area={text} />
          </Collapse>
        </div>
      )}
      <div className={styles.answer}>
        <SectionHeader title="Select speaker" action={<IconButton icon="search" size="small" label="Search speakers" onClick={onSearch} />} />
        {candidates.map(candidate => (
          <Candidate
            key={candidate.id}
            speaker={{ name: candidate.name, color: speakerColor(candidate.colorIndex) }}
            score={candidate.score}
            suggested={candidate.suggested}
            selected={candidate.id === selectedId}
            aria-pressed={candidate.id === selectedId}
            onClick={() => onSelect?.(candidate.id)}
          />
        ))}
        <Candidate kind="add" onClick={onAddNew}>Add a new speaker</Candidate>
      </div>
      <div className={styles.actions}>
        <Button variant="secondary" className={styles.action} onClick={onSkip}>Skip</Button>
        <Button variant="primary" className={styles.action} disabled={!selectedId} loading={busy} onClick={onAssign}>Assign</Button>
      </div>
    </section>
  )
}
