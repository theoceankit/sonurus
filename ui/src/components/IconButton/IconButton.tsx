import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import { Icon, type IconSize } from '../Icon/Icon'
import type { IconName } from '../Icon/icon-names'
import styles from './IconButton.module.css'

type Common = Omit<ComponentPropsWithRef<'button'>, 'children' | 'aria-label'> & {
  icon: IconName
  // There is no visible text, so this is what assistive technology reads.
  label: string
}

// The pairs that exist on the Penpot board. Only ghost toggles.
export type IconButtonProps = Common & (
  | { variant?: 'ghost'; size?: 'xs' | 'small' | 'medium'; selected?: boolean }
  | { variant: 'secondary'; size?: 'small' | 'medium'; selected?: never }
  | { variant: 'primary'; size?: 'xs' | 'small'; selected?: never }
  | { variant: 'inverse'; size?: 'large'; selected?: never }
)

const ICON_SIZE: Record<string, IconSize> = { xs: 12, small: 16, medium: 16, large: 20 }
const DEFAULT_SIZE: Record<string, string> = { ghost: 'small', secondary: 'small', primary: 'small', inverse: 'large' }

export function IconButton({
  variant = 'ghost', size, selected, icon, label, type = 'button', className, ...props
}: IconButtonProps) {
  const resolvedSize = size ?? DEFAULT_SIZE[variant]
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={selected}
      className={cx(styles.iconButton, styles[variant], styles[resolvedSize], selected && styles.selected, className)}
      {...props}
    >
      <Icon name={icon} size={ICON_SIZE[resolvedSize]} />
    </button>
  )
}
