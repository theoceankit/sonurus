import { useId, type ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import field from '../../styles/field.module.css'
import { Stack } from '../Stack/Stack'
import styles from './TextField.module.css'

interface TextFieldProps extends Omit<ComponentPropsWithRef<'input'>, 'prefix'> {
  // Without a label, name the field with aria-label.
  label?: string
  optional?: boolean
  // Text inside the field before the value, such as "@".
  prefix?: string
  helper?: string
  // Replaces the helper and marks the field as invalid.
  error?: string
}

export function TextField({ label, optional, prefix, helper, error, disabled, id, className, ...props }: TextFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const message = error ?? helper
  const messageId = `${inputId}-message`
  return (
    <Stack gap={1} align="stretch" className={cx(styles.textField, disabled && styles.disabled, className)}>
      {label && (
        <div className={styles.labelRow}>
          <label htmlFor={inputId} className={styles.label}>{label}</label>
          {optional && <span className={styles.optional}>Optional</span>}
        </div>
      )}
      <div className={cx(field.field, error && field.error, styles.box)}>
        {prefix && <span className={styles.prefix}>{prefix}</span>}
        <input
          id={inputId}
          className={field.input}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          {...props}
        />
      </div>
      {message && <span id={messageId} className={cx(field.message, error && field.messageError)}>{message}</span>}
    </Stack>
  )
}
