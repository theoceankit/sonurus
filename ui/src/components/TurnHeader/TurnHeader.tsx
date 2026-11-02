import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { Avatar } from '../Avatar/Avatar'
import { Icon } from '../Icon/Icon'
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
  // Gets the name, for the menu to open under it.
  onOpenMenu?: (name: HTMLElement) => void
  onSeek?: () => void
}

// The line above the paragraphs of a turn. Its buttons take no stop of Tab: a long
// recording has thousands, so the list moves over them with the arrow keys.
export function TurnHeader({ speaker, time, open, onOpenMenu, onSeek, className, ...props }: TurnHeaderProps) {
  return (
    <div className={cx(styles.turnHeader, className)} {...props}>
      {speaker.kind === 'named'
        ? <Avatar size="small" name={speaker.name} color={speaker.color} />
        : <Avatar size="small" kind={speaker.kind} />}
      <button
        type="button"
        tabIndex={-1}
        data-nav=""
        className={cx(styles.name, open && styles.open)}
        aria-haspopup="dialog"
        aria-expanded={open ?? false}
        onClick={event => onOpenMenu?.(event.currentTarget)}
      >
        <span className={styles.label}>{speaker.name}</span>
        <Icon name="chevron-down" size={12} className={styles.chevron} />
      </button>
      <button type="button" tabIndex={-1} data-nav="" className={styles.time} aria-label={`Go to ${time}`} onClick={onSeek}>{time}</button>
    </div>
  )
}
