import type { ComponentPropsWithRef, MouseEvent } from 'react'
import { cx } from '../../styles/cx'
import { Icon } from '../Icon/Icon'
import type { IconName } from '../Icon/icon-names'
import styles from './Button.module.css'

type Common = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  children: string
  icon?: IconName
}

// The pairs that exist on the Penpot board. `variant` is Penpot's Type: `type`
// on a button is already the HTML attribute.
export type ButtonProps = Common & (
  | { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'small' | 'medium'; loading?: boolean; timer?: never }
  | { variant: 'toolbar'; size?: 'small'; loading?: boolean; timer?: never }
  | { variant: 'inverse'; size?: 'small'; loading?: never; timer?: never }
  | { variant: 'record'; size?: 'small'; loading?: never; timer: string; icon?: never }
)

const SMALL_ONLY = ['toolbar', 'inverse', 'record']

export function Button({
  variant = 'secondary', size, loading, timer, icon, children, type = 'button', className, onClick, ...props
}: ButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (!loading) onClick?.(event)
  }
  return (
    <button
      type={type}
      className={cx(styles.button, styles[variant], styles[size ?? (SMALL_ONLY.includes(variant) ? 'small' : 'medium')], className)}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={handleClick}
      {...props}
    >
      {/* The spinner takes the place of what the button says rather than a place of
          its own, so the button keeps its width. A quick action ends before it shows. */}
      {loading && <span className={styles.spinner} aria-hidden />}
      {icon && <Icon name={icon} className={loading ? styles.busy : undefined} />}
      {variant === 'record' && <span className={styles.dot} aria-hidden />}
      {variant === 'record' && <span className={styles.timer}>{timer} </span>}
      <span className={loading ? styles.busy : undefined}>{children}</span>
    </button>
  )
}
