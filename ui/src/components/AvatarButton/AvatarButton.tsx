import type { ComponentPropsWithRef } from 'react'
import control from '../../styles/control.module.css'
import { cx } from '../../styles/cx'
import { Avatar, type AvatarSpeaker } from '../Avatar/Avatar'
import { useFileDrop } from '../AvatarModal/file-drop'
import { Icon } from '../Icon/Icon'
import styles from './AvatarButton.module.css'

type AvatarButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children' | 'color'> & {
  speaker: Extract<AvatarSpeaker, { name: string }>
  // What the button does, for assistive technology: there is no text.
  label: string
  // A picture dropped on the avatar.
  onFileDrop?: (file: File) => void
}

// A large avatar that opens the speaker's avatar window: a pencil comes over it on hover
// and focus, and a picture can be dropped on it.
export function AvatarButton({ speaker, label, onFileDrop, className, type = 'button', ...props }: AvatarButtonProps) {
  const drop = useFileDrop(file => onFileDrop?.(file), Boolean(onFileDrop) && !props.disabled)
  return (
    <button
      type={type}
      aria-label={label}
      className={cx(control.reset, control.focusRing, styles.avatarButton, className)}
      data-over={drop.over ? '' : undefined}
      {...drop.handlers}
      {...props}
    >
      <Avatar {...speaker} size="large" />
      <span className={styles.overlay} aria-hidden><Icon name="edit" size={20} /></span>
    </button>
  )
}
