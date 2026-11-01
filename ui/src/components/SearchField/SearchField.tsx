import { useEffect, useRef, type ComponentPropsWithoutRef } from 'react'
import { cx } from '../../styles/cx'
import field from '../../styles/field.module.css'
import { Icon } from '../Icon/Icon'
import { IconButton } from '../IconButton/IconButton'
import { Kbd } from '../Kbd/Kbd'
import { Stack } from '../Stack/Stack'
import styles from './SearchField.module.css'

interface SearchFieldProps extends Omit<ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'type'> {
  value: string
  onValueChange: (value: string) => void
  // Shown while the field is empty; a filled field shows the clear button there.
  shortcut?: string[]
  error?: string
}

export function SearchField({ value, onValueChange, shortcut, error, disabled, className, ...props }: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  const filled = value !== ''

  // Radix closes its layers on an Escape it hears on the document while the
  // event goes down, before any handler on this field. Only the window comes
  // earlier, and a filled field must take the first Escape for itself.
  useEffect(() => {
    if (!filled || disabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.target !== input.current) return
      event.preventDefault()
      event.stopPropagation()
      onValueChange('')
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [filled, disabled, onValueChange])

  return (
    <Stack gap={1} align="stretch" className={cx(styles.searchField, disabled && styles.disabled, className)}>
      <div className={cx(field.field, error && field.error, styles.box)}>
        <Icon name="search" size={12} className={styles.icon} />
        <input
          ref={input}
          type="search"
          className={cx(field.input, styles.input)}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={event => onValueChange(event.target.value)}
          {...props}
        />
        {shortcut && !filled && <Kbd keys={shortcut} />}
        {filled && (
          <IconButton
            icon="close"
            label="Clear search"
            size="xs"
            disabled={disabled}
            onClick={() => {
              onValueChange('')
              input.current?.focus()
            }}
          />
        )}
      </div>
      {error && <span className={cx(field.message, field.messageError)}>{error}</span>}
    </Stack>
  )
}
