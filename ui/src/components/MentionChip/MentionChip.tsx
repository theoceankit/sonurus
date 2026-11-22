import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { Avatar } from '../Avatar/Avatar'
import styles from './MentionChip.module.css'

// A speaker from the base, or a person who is not in it (someone from a chat, say):
// only the name was typed, so there is no avatar.
export type MentionChipTarget =
  | { kind: 'speaker'; name: string; color: SpeakerColor; photo?: string | null; handle?: string | null }
  | { kind: 'person'; name: string }

type MentionChipProps = Omit<ComponentPropsWithRef<'span'>, 'children'> & {
  target: MentionChipTarget
  // Selected as a whole in the note, as a node the cursor cannot enter.
  selected?: boolean
}

// Someone mentioned in a note. A speaker shows as they are now: a new name or photo
// comes through, because the note keeps the speaker, not the text.
export function MentionChip({ target, selected, className, ...props }: MentionChipProps) {
  const speaker = target.kind === 'speaker'
  return (
    <span
      className={cx(styles.chip, speaker ? styles.speaker : styles.person, selected && styles.selected, className)}
      title={speaker && target.handle ? `@${target.handle}` : undefined}
      {...props}
    >
      {speaker
        ? <Avatar name={target.name} color={target.color} photo={target.photo} size="small" className={styles.avatar} />
        : <span className={styles.at}>@</span>}
      <span className={styles.name}>{target.name}</span>
    </span>
  )
}
