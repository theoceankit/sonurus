import * as RadixSelect from '@radix-ui/react-select'
import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react'
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
// The list also starts on the chosen row, focused, so it starts with the input that
// opened it: a click after a key would otherwise ring the row.
const pointerInput = (event: PointerEvent<HTMLElement>) => { event.currentTarget.dataset.input = 'pointer' }
const keyboardInput = (event: KeyboardEvent<HTMLElement>) => { delete event.currentTarget.dataset.input }

// One value of a short list, in a field like TextField: a combobox named by its label,
// with a listbox of options, as a native select is read. The list is as wide as the
// field and stays inside the window it is in: it opens upwards when there is more
// room there and scrolls when it does not fit either way.
export function Select({ label, 'aria-label': ariaLabel, value, options, onValueChange, placeholder, disabled, className }: SelectProps) {
  const { boundary } = useModal()
  const labelId = useId()
  const current = options.find(option => option.value === value)
  const [openedBy, setOpenedBy] = useState<'pointer' | undefined>()
  return (
    <Stack gap={1} align="stretch" className={cx(styles.select, disabled && styles.disabled, className)}>
      {label
        ? <span id={labelId} className={styles.label}>{label}</span>
        : <span id={labelId} hidden>{ariaLabel}</span>}
      <RadixSelect.Root value={current ? value : ''} onValueChange={onValueChange} disabled={disabled}>
        <RadixSelect.Trigger
          className={cx(field.field, styles.trigger)}
          aria-labelledby={labelId}
          onPointerDown={() => setOpenedBy('pointer')}
          onKeyDown={() => setOpenedBy(undefined)}
        >
          <span className={cx(styles.value, !current && styles.placeholder)}>{current?.label ?? placeholder ?? ''}</span>
          <Icon name="chevron-down" size={12} className={styles.chevron} />
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            asChild
            position="popper"
            aria-labelledby={labelId}
            data-input={openedBy}
            align="start"
            sideOffset={OFFSET}
            collisionBoundary={boundary}
            collisionPadding={OFFSET}
            onPointerMove={pointerInput}
            onKeyDownCapture={keyboardInput}
          >
            <MenuSurface className={styles.list}>
              <RadixSelect.Viewport asChild>
                <Stack gap="half" align="stretch" className={styles.viewport}>
                  {options.map(option => (
                    <RadixSelect.Item
                      key={option.value}
                      asChild
                      value={option.value}
                      disabled={option.disabled}
                      textValue={option.label}
                      // Named by the whole row, so the reason an option is off is read with it.
                      aria-labelledby={undefined}
                    >
                      <MenuItem disabled={option.disabled} selected={option.value === value} meta={option.meta}>{option.label}</MenuItem>
                    </RadixSelect.Item>
                  ))}
                </Stack>
              </RadixSelect.Viewport>
            </MenuSurface>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </Stack>
  )
}
