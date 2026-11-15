import type { ComponentPropsWithRef } from 'react'
import control from '../../styles/control.module.css'
import { cx } from '../../styles/cx'
import { Avatar, type AvatarSpeaker } from '../Avatar/Avatar'
import { Icon } from '../Icon/Icon'
import styles from './AvatarButton.module.css'

type AvatarButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children' | 'color'> & {
  speaker: Extract<AvatarSpeaker, { name: string }>
  // What the button does, for assistive technology: there is no text.
  label: string
}

// A large avatar that opens the speaker's photo: a pencil comes over it on hover and focus.
export function AvatarButton({ speaker, label, className, type = 'button', ...props }: AvatarButtonProps) {
  return (
    <button type={type} aria-label={label} className={cx(control.reset, control.focusRing, styles.avatarButton, className)} {...props}>
      <Avatar {...speaker} size="large" />
      <span className={styles.overlay} aria-hidden><Icon name="edit" size={20} /></span>
    </button>
  )
}
