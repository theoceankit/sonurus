import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { notImplementedProps, NOT_IMPLEMENTED_TOAST } from '../../not-implemented'
import { OverlayProvider } from '../../OverlayProvider'
import { Button } from '../Button/Button'
import { dismissAllToasts } from '../Toast/toast'
import { Menu, MenuAction, MenuDivider, MenuOption, MenuOptions, MenuSection, MenuSurface } from './Menu'
import css from './Menu.module.css?raw'

afterEach(() => act(() => dismissAllToasts()))

const actions = (onSelect = () => {}) => render(
  <OverlayProvider>
    <Menu trigger={<Button>Open</Button>}>
      <MenuAction onSelect={onSelect}>Rename</MenuAction>
      <MenuAction disabled onSelect={onSelect}>Merge</MenuAction>
      <MenuDivider />
      <MenuAction onSelect={onSelect} icon="copy">Copy</MenuAction>
    </Menu>
  </OverlayProvider>,
)
const trigger = () => screen.getByRole('button', { name: 'Open' })
const item = (name: string) => screen.getByRole('menuitem', { name })

test('Enter on the trigger opens the menu on the first item', async () => {
  actions()
  trigger().focus()
  await userEvent.keyboard('{Enter}')
  expect(document.activeElement).toBe(item('Rename'))
})

test('arrows move through the items and skip a disabled one', async () => {
  actions()
  trigger().focus()
  await userEvent.keyboard('{Enter}{ArrowDown}')
  expect(document.activeElement).toBe(item('Copy'))
  await userEvent.keyboard('{ArrowUp}')
  expect(document.activeElement).toBe(item('Rename'))
})

test('Enter selects and closes, and focus goes back to the trigger', async () => {
  const onSelect = vi.fn()
  actions(onSelect)
  trigger().focus()
  await userEvent.keyboard('{Enter}{Enter}')
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(trigger())
})

test('Escape closes without selecting, and focus goes back to the trigger', async () => {
  const onSelect = vi.fn()
  actions(onSelect)
  trigger().focus()
  await userEvent.keyboard('{Enter}{Escape}')
  expect(onSelect).not.toHaveBeenCalled()
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(trigger())
})

test('a click selects, a click on a disabled item does nothing', async () => {
  const onSelect = vi.fn()
  actions(onSelect)
  await userEvent.click(trigger())
  await userEvent.click(item('Merge'))
  expect(onSelect).not.toHaveBeenCalled()
  await userEvent.click(item('Copy'))
  expect(onSelect).toHaveBeenCalledTimes(1)
})

test('the divider separates and sections name their items', async () => {
  render(
    <OverlayProvider>
      <Menu trigger={<Button>Open</Button>} defaultOpen>
        <MenuSection title="In this recording"><MenuAction>Mark Ellis</MenuAction></MenuSection>
        <MenuDivider />
      </Menu>
    </OverlayProvider>,
  )
  expect(screen.getByRole('separator')).toBeTruthy()
  expect(screen.getByRole('group').textContent).toContain('In this recording')
})

test('options show the chosen one, and choosing reports the new one', async () => {
  const onValueChange = vi.fn()
  render(
    <OverlayProvider>
      <Menu trigger={<Button>Open</Button>} defaultOpen>
        <MenuOptions value="small" onValueChange={onValueChange}>
          <MenuOption value="small">Small</MenuOption>
          <MenuOption value="large">Large</MenuOption>
        </MenuOptions>
      </Menu>
    </OverlayProvider>,
  )
  const option = (name: string) => screen.getByRole('menuitemradio', { name })
  expect(option('Small').getAttribute('aria-checked')).toBe('true')
  expect(option('Large').getAttribute('aria-checked')).toBe('false')
  expect(option('Small').querySelector('svg')).toBeTruthy()
  expect(option('Large').querySelector('svg')).toBeNull()
  await userEvent.click(option('Large'))
  expect(onValueChange).toHaveBeenCalledWith('large')
})

test('a marked item only shows the toast and leaves the menu open', async () => {
  const onSelect = vi.fn()
  render(
    <OverlayProvider>
      <Menu trigger={<Button>Open</Button>} defaultOpen>
        <MenuAction onSelect={onSelect} {...notImplementedProps('segment.bookmark')}>Bookmark</MenuAction>
        <MenuAction>Copy</MenuAction>
      </Menu>
    </OverlayProvider>,
  )
  await userEvent.click(item('Bookmark'))
  item('Bookmark').focus()
  await userEvent.keyboard('{Enter}')
  expect(onSelect).not.toHaveBeenCalled()
  expect(screen.getByRole('menu')).toBeTruthy()
  expect(screen.getAllByText(NOT_IMPLEMENTED_TOAST).some(el => el.closest('li'))).toBe(true)
})

// Radix focuses the item under the pointer, and Chromium takes that focus for a
// keyboard one when nothing had focus before, so :focus-visible alone draws the ring.
test('the focus ring shows only after the keyboard', async () => {
  actions()
  await userEvent.click(trigger())
  const menu = screen.getByRole('menu')
  fireEvent.pointerMove(item('Copy'))
  expect(menu.dataset.input).toBe('pointer')
  expect(css).toMatch(/\.surface\[data-input='pointer'\] :focus-visible \{\s*outline: none;/)
  fireEvent.keyDown(item('Copy'), { key: 'ArrowUp' })
  expect(menu.dataset.input).toBeUndefined()
})

test('the surface stands alone', () => {
  render(<MenuSurface data-testid="surface">Content</MenuSurface>)
  expect(screen.getByTestId('surface').className).toContain('surface')
})
