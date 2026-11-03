import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { Avatar } from '../Avatar/Avatar'
import styles from './TurnHeader.module.css'

export interface TurnHeaderSpeaker {
  kind: 'named' | 'unknown' | 'unassigned'
  name: string
  color: SpeakerColor
}

type TurnHeaderProps = Omit<ComponentPropsWithRef<'div'>, 'children'> & {
  speaker: TurnHeaderSpeaker
  time: string
  // Its speaker menu is open: the name looks pressed.
  open?: boolean
  // Gets the button of the avatar and name, for the menu to open under it.
  onOpenMenu?: (name: HTMLElement) => void
  onSeek?: () => void
}

// The line above the paragraphs of a turn. Its buttons take no stop of Tab: a long
// recording has thousands, so the list moves over them with the arrow keys.
export function TurnHeader({ speaker, time, open, onOpenMenu, onSeek, className, ...props }: TurnHeaderProps) {
  return (
    <div className={cx(styles.turnHeader, className)} {...props}>
      <button
        type="button"
        tabIndex={-1}
        data-nav=""
        className={cx(styles.name, open && styles.open)}
        aria-haspopup="dialog"
        aria-expanded={open ?? false}
        onClick={event => onOpenMenu?.(event.currentTarget)}
      >
        {speaker.kind === 'named'
          ? <Avatar size="small" name={speaker.name} color={speaker.color} aria-hidden />
          : <Avatar size="small" kind={speaker.kind} aria-hidden />}
        <span className={styles.label}>{speaker.name}</span>
      </button>
      <button type="button" tabIndex={-1} data-nav="" className={styles.time} aria-label={`Go to ${time}`} onClick={onSeek}><span className={styles.timeText}>{time}</span></button>
    </div>
  )
}
