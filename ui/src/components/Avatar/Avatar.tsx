import { useState, type ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { speakerInitials } from './initials'
import styles from './Avatar.module.css'

export type AvatarSize = 'xs' | 'small' | 'medium' | 'large'

// Which colour a speaker gets is decided by the data layer. photo: the address of a
// named speaker's photo, shown instead of the initials.
export type AvatarSpeaker =
  | { kind?: 'named'; name: string; color: SpeakerColor; photo?: string | null }
  | { kind: 'unknown' | 'unassigned'; name?: never; color?: never; photo?: never }

// A speaker with something to read next to the avatar, whichever kind. Only a named
// one shows a photo.
export type LabelledSpeaker =
  | { kind?: 'named'; name: string; color: SpeakerColor; photo?: string | null }
  | { kind: 'unknown' | 'unassigned'; name: string; color?: SpeakerColor; photo?: string | null }

export function avatarOf(speaker: LabelledSpeaker): AvatarSpeaker {
  if (speaker.kind === 'unknown' || speaker.kind === 'unassigned') return { kind: speaker.kind }
  return { name: speaker.name, color: speaker.color!, photo: speaker.photo }
}

type AvatarProps = Omit<ComponentPropsWithRef<'span'>, 'children' | 'color'> & AvatarSpeaker & { size?: AvatarSize }

const GRAY: SpeakerColor = 6

// Every speaker avatar comes from here, and only this component draws initials. A
// photo covers them; one that does not load leaves the initials.
export function Avatar({ kind = 'named', name, color, photo, size = 'medium', className, style, ...props }: AvatarProps) {
  const palette = color ?? GRAY
  const initials = kind === 'named' ? speakerInitials(name ?? '') : '?'
  const [failed, setFailed] = useState<string | null>(null)
  const shown = kind === 'named' && photo && photo !== failed ? photo : null
  return (
    <span
      className={cx(styles.avatar, styles[size], className)}
      style={{ background: `var(--color-speaker-${palette}-bg)`, color: `var(--color-speaker-${palette}-fg)`, ...style }}
      data-photo={shown ? '' : undefined}
      {...props}
    >
      {shown
        ? <img className={styles.photo} src={shown} alt="" draggable={false} onError={() => setFailed(shown)} />
        : <span className={styles.initials} data-initials="">{size === 'xs' ? [...initials].slice(0, 1).join('') : initials}</span>}
    </span>
  )
}
