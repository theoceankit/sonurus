import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import styles from './Toggle.module.css'

interface ToggleProps extends Omit<ComponentPropsWithRef<'button'>, 'onChange' | 'children' | 'value'> {
  checked: boolean
  onChange?: (checked: boolean) => void
  // Usually there is no visible text next to it: this is what assistive technology reads.
  label: string
}

// An on/off switch that acts at once, without a Save.
export function Toggle({ checked, onChange, label, className, onClick, ...props }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx(styles.toggle, className)}
      onClick={event => {
        onClick?.(event)
        if (!event.defaultPrevented) onChange?.(!checked)
      }}
      {...props}
    >
      <span className={styles.thumb} />
    </button>
  )
}
