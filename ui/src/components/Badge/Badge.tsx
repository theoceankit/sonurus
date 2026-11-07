import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import styles from './Badge.module.css'

type Common = ComponentPropsWithRef<'span'>

// Label is a status pill or a tag. Count is a number next to a title or a tab,
// shown also for 0; it exists only in the neutral and on-accent tones.
// A medium label has room around its text, for a status that stands alone, such as a
// card's state in Settings.
export type BadgeProps = Common & (
  | { variant?: 'label'; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'onAccent'; size?: 'small' | 'medium' }
  | { variant: 'count'; tone?: 'neutral' | 'onAccent'; size?: never }
)

export function Badge({ variant = 'label', tone = 'neutral', size = 'small', className, ...props }: BadgeProps) {
  return <span className={cx(styles.badge, styles[variant], styles[tone], size === 'medium' && styles.medium, className)} {...props} />
}
