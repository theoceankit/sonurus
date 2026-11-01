import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import { Icon } from '../Icon/Icon'
import type { IconName } from '../Icon/icon-names'
import styles from './MenuItem.module.css'

type Common = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  children: string
  icon?: IconName
  meta?: string
  meta2?: string
}

// Selected is a chosen option, with a check mark. Current is the page or filter
// you are on, with a background. An item is never both.
export type MenuItemProps = Common & (
  | { selected?: boolean; current?: never }
  | { selected?: never; current?: boolean }
)

// One row; a menu around it adds roles and arrow keys through asChild.
export function MenuItem({ icon, meta, meta2, selected, current, children, type = 'button', className, ...props }: MenuItemProps) {
  return (
    <button
      type={type}
      className={cx(styles.menuItem, current && styles.current, className)}
      aria-current={current || undefined}
      {...props}
    >
      {icon && <Icon name={icon} className={styles.leading} />}
      <span className={styles.label}>{children}</span>
      {meta && <span className={styles.meta}>{meta}</span>}
      {meta2 && <span className={styles.meta}>{meta2}</span>}
      {selected && <Icon name="check" size={12} className={styles.check} />}
    </button>
  )
}
