import * as RadixMenu from '@radix-ui/react-dropdown-menu'
import { createContext, useContext, type ComponentPropsWithRef, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react'
import { cx } from '../../styles/cx'
import { MenuItem, type MenuItemProps } from '../MenuItem/MenuItem'
import { SectionHeader } from '../SectionHeader/SectionHeader'
import { Stack } from '../Stack/Stack'
import styles from './Menu.module.css'

// The panel of a menu, for a menu that is not this list of actions, such as one
// with a search field that keeps the focus.
export function MenuSurface({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return <div className={cx(styles.surface, className)} {...props} />
}

interface MenuProps {
  // One element that takes a ref and pointer handlers, usually a button.
  trigger: ReactElement
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom'
  // The distance from the trigger.
  offset?: number
  // Narrow is for a short list of short values.
  size?: 'default' | 'narrow'
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  // Prevent it when an action leaves the focus somewhere else, such as in another layer.
  onCloseAutoFocus?: (event: Event) => void
}

const OFFSET = 4

// Radix focuses the item under the pointer, and Chromium takes that focus for a
// keyboard one when nothing had focus before. So the menu remembers the last input,
// on the element, because this changes with every move of the pointer.
const pointerInput = (event: PointerEvent<HTMLElement>) => { event.currentTarget.dataset.input = 'pointer' }
const keyboardInput = (event: KeyboardEvent<HTMLElement>) => { delete event.currentTarget.dataset.input }

// Not modal: a modal menu locks the scroll and shifts the page behind it, and an
// outside click closes this one all the same.
export function Menu({ trigger, children, align = 'start', side = 'bottom', offset = OFFSET, size = 'default', onCloseAutoFocus, ...props }: MenuProps) {
  return (
    <RadixMenu.Root modal={false} {...props}>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content asChild align={align} side={side} sideOffset={offset} onCloseAutoFocus={onCloseAutoFocus} onPointerMove={pointerInput} onKeyDownCapture={keyboardInput}>
          <MenuSurface className={size === 'narrow' ? styles.narrow : undefined}>{children}</MenuSurface>
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  )
}

type MenuActionProps = MenuItemProps & { onSelect?: () => void }

// A row that does something; selecting it closes the menu.
export function MenuAction({ onSelect, disabled, ...props }: MenuActionProps) {
  return (
    <RadixMenu.Item asChild disabled={disabled} onSelect={onSelect}>
      <MenuItem disabled={disabled} {...props as MenuItemProps} />
    </RadixMenu.Item>
  )
}

const OptionsValue = createContext<string | undefined>(undefined)

interface MenuOptionsProps {
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
}

// Rows of which one is chosen, marked with a check.
export function MenuOptions({ value, onValueChange, children }: MenuOptionsProps) {
  return (
    <RadixMenu.RadioGroup asChild value={value} onValueChange={onValueChange}>
      <Stack gap="half" align="stretch">
        <OptionsValue.Provider value={value}>{children}</OptionsValue.Provider>
      </Stack>
    </RadixMenu.RadioGroup>
  )
}

type MenuOptionProps = Omit<MenuItemProps, 'selected' | 'current' | 'value'> & { value: string }

export function MenuOption({ value, disabled, ...props }: MenuOptionProps) {
  const chosen = useContext(OptionsValue)
  return (
    <RadixMenu.RadioItem asChild value={value} disabled={disabled}>
      <MenuItem disabled={disabled} selected={chosen === value} {...props} />
    </RadixMenu.RadioItem>
  )
}

export function MenuDivider() {
  return <RadixMenu.Separator className={styles.divider} />
}

export function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <RadixMenu.Group asChild>
      <Stack gap="half" align="stretch">
        <RadixMenu.Label asChild><SectionHeader title={title} /></RadixMenu.Label>
        {children}
      </Stack>
    </RadixMenu.Group>
  )
}
