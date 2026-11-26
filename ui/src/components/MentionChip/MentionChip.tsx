import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { Avatar } from '../Avatar/Avatar'
import { Icon } from '../Icon/Icon'
import styles from './MentionChip.module.css'

// A speaker from the base; a voice in it with no name yet, by the label the transcript
// shows, with the question mark of Unnamed for an avatar; or a person who is not in the
// base (someone from a chat, say): only the name was typed, so there is no avatar.
export type MentionChipTarget =
  | { kind: 'speaker'; name: string; color: SpeakerColor; photo?: string | null; handle?: string | null }
  | { kind: 'unnamed'; name: string }
  | { kind: 'person'; name: string }

type MentionChipProps = Omit<ComponentPropsWithRef<'span'>, 'children'> & {
  target: MentionChipTarget
  // Selected as a whole in the note, as a node the cursor cannot enter.
  selected?: boolean
}

// Someone mentioned in a note. A speaker shows as they are now: a new name or photo
// comes through, because the note keeps the speaker, not the text.
export function MentionChip({ target, selected, className, ...props }: MentionChipProps) {
  return (
    <span
      className={cx(styles.chip, target.kind === 'person' ? styles.person : styles.speaker, selected && styles.selected, className)}
      title={target.kind === 'speaker' && target.handle ? `@${target.handle}` : undefined}
      {...props}
    >
      {target.kind === 'speaker'
        ? <Avatar name={target.name} color={target.color} photo={target.photo} size="small" />
        : target.kind === 'unnamed'
          ? <span className={styles.unnamed}><Icon name="speaker-unknown" /></span>
          : <span className={styles.at}>@</span>}
      <span className={styles.name}>{target.name}</span>
    </span>
  )
}
