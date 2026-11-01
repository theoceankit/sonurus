import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { speakerInitials } from './initials'
import styles from './Avatar.module.css'

export type AvatarSize = 'xs' | 'small' | 'medium' | 'large'

// Which colour a speaker gets is decided by the data layer.
export type AvatarSpeaker =
  | { kind?: 'named'; name: string; color: SpeakerColor }
  | { kind: 'unknown' | 'unassigned'; name?: never; color?: never }

type AvatarProps = Omit<ComponentPropsWithRef<'span'>, 'children' | 'color'> & AvatarSpeaker & { size?: AvatarSize }

const GRAY: SpeakerColor = 6

// Every speaker avatar comes from here, and only this component draws initials.
export function Avatar({ kind = 'named', name, color, size = 'medium', className, style, ...props }: AvatarProps) {
  const palette = color ?? GRAY
  const initials = kind === 'named' ? speakerInitials(name ?? '') : '?'
  return (
    <span
      className={cx(styles.avatar, styles[size], className)}
      style={{ background: `var(--color-speaker-${palette}-bg)`, color: `var(--color-speaker-${palette}-fg)`, ...style }}
      {...props}
    >
      {size === 'xs' ? [...initials].slice(0, 1).join('') : initials}
    </span>
  )
}
