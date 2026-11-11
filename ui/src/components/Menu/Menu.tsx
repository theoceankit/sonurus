import * as RadixContextMenu from '@radix-ui/react-context-menu'
import * as RadixDropdownMenu from '@radix-ui/react-dropdown-menu'
import { createContext, useContext, type ComponentPropsWithRef, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react'
import { cx } from '../../styles/cx'
import { MenuItem, type MenuItemProps } from '../MenuItem/MenuItem'
import { SectionHeader } from '../SectionHeader/SectionHeader'
import { Stack } from '../Stack/Stack'
import { markFocusGivenBack } from '../Tooltip/Tooltip'
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

// The items below work in both menus: each takes the parts of the menu it is in.
const Parts = createContext<typeof RadixDropdownMenu | typeof RadixContextMenu>(RadixDropdownMenu)
const useParts = () => useContext(Parts) as typeof RadixDropdownMenu

// Radix focuses the item under the pointer, and Chromium takes that focus for a
// keyboard one when nothing had focus before. So the menu remembers the last input,
// on the element, because this changes with every move of the pointer.
const pointerInput = (event: PointerEvent<HTMLElement>) => { event.currentTarget.dataset.input = 'pointer' }
const keyboardInput = (event: KeyboardEvent<HTMLElement>) => { delete event.currentTarget.dataset.input }

// Focus the menu gives back to its button shows no tooltip, as after a modal.
const givingFocusBack = (own?: (event: Event) => void) => (event: Event) => {
  own?.(event)
  const button = document.getElementById((event.currentTarget as Element).getAttribute('aria-labelledby') ?? '')
  if (button && !event.defaultPrevented) markFocusGivenBack(button)
}

// Not modal: a modal menu locks the scroll and shifts the page behind it, and an
// outside click closes this one all the same.
export function Menu({ trigger, children, align = 'start', side = 'bottom', offset = OFFSET, size = 'default', onCloseAutoFocus, ...props }: MenuProps) {
  return (
    <RadixDropdownMenu.Root modal={false} {...props}>
      <RadixDropdownMenu.Trigger asChild>{trigger}</RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content asChild align={align} side={side} sideOffset={offset} onCloseAutoFocus={givingFocusBack(onCloseAutoFocus)} onPointerMove={pointerInput} onKeyDownCapture={keyboardInput}>
          <MenuSurface className={size === 'narrow' ? styles.narrow : undefined}>
            <Parts.Provider value={RadixDropdownMenu}>{children}</Parts.Provider>
          </MenuSurface>
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  )
}

interface ContextMenuProps {
  // The target: one element that takes a ref and event handlers, such as a row.
  children: ReactElement
  // The items, as in Menu.
  content: ReactNode
  onOpenChange?: (open: boolean) => void
  // Prevent it when an action leaves the focus somewhere else, such as in a field.
  onCloseAutoFocus?: (event: Event) => void
  // The target opens nothing, and the browser's menu does not open either.
  disabled?: boolean
}

// A menu at the pointer, opened by the contextmenu event of its target: a right
// click, the Menu key or Shift+F10 (from the keyboard Chromium places it at the
// focused element). Not modal, for the same reasons as Menu.
export function ContextMenu({ children, content, onOpenChange, onCloseAutoFocus, disabled }: ContextMenuProps) {
  return (
    <RadixContextMenu.Root modal={false} onOpenChange={onOpenChange}>
      <RadixContextMenu.Trigger asChild disabled={disabled}>{children}</RadixContextMenu.Trigger>
      <RadixContextMenu.Portal>
        <RadixContextMenu.Content asChild onCloseAutoFocus={onCloseAutoFocus} onPointerMove={pointerInput} onKeyDownCapture={keyboardInput}>
          <MenuSurface>
            <Parts.Provider value={RadixContextMenu}>{content}</Parts.Provider>
          </MenuSurface>
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Root>
  )
}

type MenuActionProps = MenuItemProps & { onSelect?: () => void }

// A row that does something; selecting it closes the menu.
export function MenuAction({ onSelect, disabled, ...props }: MenuActionProps) {
  const RadixMenu = useParts()
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
  const RadixMenu = useParts()
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
  const RadixMenu = useParts()
  return (
    <RadixMenu.RadioItem asChild value={value} disabled={disabled}>
      <MenuItem disabled={disabled} selected={chosen === value} {...props} />
    </RadixMenu.RadioItem>
  )
}

export function MenuDivider() {
  const RadixMenu = useParts()
  return <RadixMenu.Separator className={styles.divider} />
}

export function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  const RadixMenu = useParts()
  return (
    <RadixMenu.Group asChild>
      <Stack gap="half" align="stretch">
        <RadixMenu.Label asChild><SectionHeader title={title} /></RadixMenu.Label>
        {children}
      </Stack>
    </RadixMenu.Group>
  )
}
