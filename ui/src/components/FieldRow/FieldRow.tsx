import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import { cx } from '../../styles/cx'
import styles from './FieldRow.module.css'

interface FieldRowProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  label: string
  hint?: ReactNode
  // The control: a Select, a Toggle, a Slider, a TextField, a Button.
  children: ReactNode
  // Under the label at the full width, for what needs room (a slider with marks, a token).
  stacked?: boolean
  // Under the row, at its width: a warning about what was picked.
  note?: ReactNode
}

// One setting: what it is on the left, the control on the right. The control keeps
// its own name for assistive technology; the row is a group named by the label.
export function FieldRow({ label, hint, children, stacked, note, className, ...props }: FieldRowProps) {
  const labelId = useId()
  const hintId = useId()
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
      className={cx(styles.fieldRow, stacked && styles.stacked, className)}
      {...props}
    >
      <div className={styles.text}>
        <span id={labelId} className={styles.label}>{label}</span>
        {hint && <span id={hintId} className={styles.hint}>{hint}</span>}
      </div>
      <div className={styles.control}>{children}</div>
      {note && <div className={styles.note}>{note}</div>}
    </div>
  )
}
