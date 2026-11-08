import * as RadixMenu from '@radix-ui/react-dropdown-menu'
import { useId, type KeyboardEvent, type PointerEvent } from 'react'
import { cx } from '../../styles/cx'
import field from '../../styles/field.module.css'
import { Icon } from '../Icon/Icon'
import { MenuItem } from '../MenuItem/MenuItem'
import { MenuSurface } from '../Menu/Menu'
import { useModal } from '../Modal/Modal'
import { Stack } from '../Stack/Stack'
import styles from './Select.module.css'

export type SelectOption = {
  value: string
  label: string
  // Shown at the end of the row, such as "Not installed" for an option that is off.
  meta?: string
  disabled?: boolean
}

interface SelectProps {
  // Without a label, name the select with aria-label.
  label?: string
  'aria-label'?: string
  value: string
  options: readonly SelectOption[]
  onValueChange: (value: string) => void
  // In the field when the value is none of the options, such as while they load.
  placeholder?: string
  disabled?: boolean
  className?: string
}

const OFFSET = 4

// As in Menu: Chromium takes the focus of the row under the pointer for a keyboard one.
const pointerInput = (event: PointerEvent<HTMLElement>) => { event.currentTarget.dataset.input = 'pointer' }
const keyboardInput = (event: KeyboardEvent<HTMLElement>) => { delete event.currentTarget.dataset.input }

// One value of a short list, in a field like TextField. The list is as wide as the
// field and stays inside the window it is in: it opens upwards when there is more
// room there and scrolls when it does not fit either way.
export function Select({ label, 'aria-label': ariaLabel, value, options, onValueChange, placeholder, disabled, className }: SelectProps) {
  const { boundary } = useModal()
  const labelId = useId()
  const valueId = useId()
  const current = options.find(option => option.value === value)
  return (
    <Stack gap={1} align="stretch" className={cx(styles.select, disabled && styles.disabled, className)}>
      {label
        ? <span id={labelId} className={styles.label}>{label}</span>
        : <span id={labelId} hidden>{ariaLabel}</span>}
      <RadixMenu.Root modal={false}>
        <RadixMenu.Trigger asChild disabled={disabled}>
          <button
            type="button"
            className={cx(field.field, styles.trigger)}
            // Named by the label and the value, as a native select is read.
            aria-labelledby={`${labelId} ${valueId}`}
          >
            <span id={valueId} className={cx(styles.value, !current && styles.placeholder)}>{current?.label ?? placeholder ?? ''}</span>
            <Icon name="chevron-down" size={12} className={styles.chevron} />
          </button>
        </RadixMenu.Trigger>
        <RadixMenu.Portal>
          <RadixMenu.Content
            asChild
            align="start"
            sideOffset={OFFSET}
            collisionBoundary={boundary}
            collisionPadding={OFFSET}
            onPointerMove={pointerInput}
            onKeyDownCapture={keyboardInput}
          >
            <MenuSurface className={styles.list}>
              <RadixMenu.RadioGroup asChild value={value} onValueChange={onValueChange}>
                <Stack gap="half" align="stretch">
                  {options.map(option => (
                    <RadixMenu.RadioItem key={option.value} asChild value={option.value} disabled={option.disabled}>
                      <MenuItem disabled={option.disabled} selected={option.value === value} meta={option.meta}>{option.label}</MenuItem>
                    </RadixMenu.RadioItem>
                  ))}
                </Stack>
              </RadixMenu.RadioGroup>
            </MenuSurface>
          </RadixMenu.Content>
        </RadixMenu.Portal>
      </RadixMenu.Root>
    </Stack>
  )
}
