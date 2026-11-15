import type { ComponentPropsWithRef } from 'react'
import control from '../../styles/control.module.css'
import { cx } from '../../styles/cx'
import { Avatar, type AvatarSpeaker } from '../Avatar/Avatar'
import { useFileDrop } from '../AvatarModal/file-drop'
import { Icon } from '../Icon/Icon'
import type { IconName } from '../Icon/icon-names'
import styles from './AvatarButton.module.css'

type AvatarButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children' | 'color'> & {
  speaker: Extract<AvatarSpeaker, { name: string }>
  // What the button does, for assistive technology: there is no text.
  label: string
  // A picture dropped on the avatar.
  onFileDrop?: (file: File) => void
  // What comes over the avatar on hover and focus: the pencil opens, the bin removes.
  icon?: Extract<IconName, 'edit' | 'delete'>
  size?: 'large' | 'xlarge'
}

// A large avatar as a button: what it does comes over it on hover and focus, a pencil
// for the avatar window or a bin for the photo, and a picture can be dropped on it.
export function AvatarButton({ speaker, label, onFileDrop, icon = 'edit', size = 'large', className, type = 'button', ...props }: AvatarButtonProps) {
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
      <Avatar {...speaker} size={size} />
      <span className={styles.overlay} aria-hidden><Icon name={icon} size={size === 'xlarge' ? 24 : 20} /></span>
    </button>
  )
}
