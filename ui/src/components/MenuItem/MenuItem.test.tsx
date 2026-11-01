import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { expect, test, vi } from 'vitest'
import { MenuItem } from './MenuItem'

const item = () => screen.getByRole('button')

test('Enter, Space and a click run it', async () => {
  const onClick = vi.fn()
  render(<MenuItem onClick={onClick}>Rename</MenuItem>)
  await userEvent.tab()
  expect(document.activeElement).toBe(item())
  await userEvent.keyboard('{Enter}')
  await userEvent.keyboard(' ')
  await userEvent.click(item())
  expect(onClick).toHaveBeenCalledTimes(3)
})

test('disabled is skipped by Tab and does not run', async () => {
  const onClick = vi.fn()
  render(<MenuItem onClick={onClick} disabled>Rename</MenuItem>)
  await userEvent.tab()
  expect(document.activeElement).not.toBe(item())
  await userEvent.click(item())
  expect(onClick).not.toHaveBeenCalled()
})

test('selected draws a check mark, current does not', () => {
  const { container, rerender } = render(<MenuItem>All speakers</MenuItem>)
  expect(container.querySelector('svg')).toBeNull()

  rerender(<MenuItem selected>All speakers</MenuItem>)
  expect(container.querySelectorAll('svg')).toHaveLength(1)
  expect(item().hasAttribute('aria-current')).toBe(false)

  rerender(<MenuItem current>All speakers</MenuItem>)
  expect(container.querySelector('svg')).toBeNull()
  expect(item().getAttribute('aria-current')).toBe('true')
  expect(item().className).toMatch(/\bcurrent\b/)
})

test('selected and current together are a type error', () => {
  // @ts-expect-error an item is never both
  const wrong = () => <MenuItem selected current>All speakers</MenuItem>
  expect(wrong).toBeTypeOf('function')
})

test('shows the leading icon and the meta texts when given', () => {
  const { container } = render(<MenuItem icon="settings" meta="Ctrl S" meta2="New">Settings</MenuItem>)
  expect(container.querySelectorAll('svg')).toHaveLength(1)
  expect(screen.getByText('Ctrl S')).toBeTruthy()
  expect(screen.getByText('New')).toBeTruthy()
})

test('takes what a Radix menu passes through asChild', () => {
  const ref = createRef<HTMLButtonElement>()
  render(<MenuItem ref={ref} role="menuitem" tabIndex={-1} data-highlighted="">Rename</MenuItem>)
  expect(ref.current).toBe(screen.getByRole('menuitem', { name: 'Rename' }))
  expect(ref.current?.tabIndex).toBe(-1)
  expect(ref.current?.hasAttribute('data-highlighted')).toBe(true)
})
