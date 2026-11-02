import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { parseTokens } from '../../styles/tokens'
import tokensCss from '../../styles/tokens.css?raw'
import { dismissAllToasts, toast } from './toast'
import { Toaster } from './Toast'
import css from './Toast.module.css?raw'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  act(() => dismissAllToasts())
  vi.useRealTimers()
})

const show = (...args: Parameters<typeof toast>) => {
  let dismiss = () => {}
  act(() => { dismiss = toast(...args) })
  return dismiss
}
const passed = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const shown = (message: string) => screen.queryAllByText(message).some(el => !el.closest('[data-radix-toast-announce-exclude]') && el.closest('li'))

test('a toast shows its message and goes away by itself after 3.2 seconds', () => {
  render(<Toaster />)
  show({ message: 'Saved' })
  expect(shown('Saved')).toBe(true)
  passed(3100)
  expect(shown('Saved')).toBe(true)
  passed(200)
  expect(shown('Saved')).toBe(false)
})

test('a toast with an action stays for 6 seconds', () => {
  render(<Toaster />)
  show({ message: 'Deleted', action: { label: 'Undo', onClick: () => {} } })
  passed(5900)
  expect(shown('Deleted')).toBe(true)
  passed(200)
  expect(shown('Deleted')).toBe(false)
})

test('the action runs once and closes the toast', () => {
  const onClick = vi.fn()
  render(<Toaster />)
  show({ message: 'Deleted', action: { label: 'Undo', onClick } })
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(onClick).toHaveBeenCalledTimes(1)
  expect(shown('Deleted')).toBe(false)
})

test('the close button closes the toast without running the action', () => {
  const onClick = vi.fn()
  render(<Toaster />)
  show({ message: 'Deleted', action: { label: 'Undo', onClick } })
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClick).not.toHaveBeenCalled()
  expect(shown('Deleted')).toBe(false)
})

test('the type sets the style and only an action adds a second button', () => {
  render(<Toaster />)
  show({ message: 'Failed', type: 'error' })
  expect(screen.getAllByText('Failed').map(el => el.closest('li')).find(Boolean)?.className).toContain('error')
  expect(screen.getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual(['Close'])
})

test('the function it returns takes the toast away', () => {
  render(<Toaster />)
  const dismiss = show({ message: 'Working' })
  act(() => dismiss())
  expect(shown('Working')).toBe(false)
})

test('at most three stay, and the oldest goes first', () => {
  render(<Toaster />)
  for (const message of ['One', 'Two', 'Three', 'Four']) show({ message })
  expect(shown('One')).toBe(false)
  for (const message of ['Two', 'Three', 'Four']) expect(shown(message)).toBe(true)
})

test('focus on a toast stops its timer', () => {
  render(<Toaster />)
  show({ message: 'Deleted', action: { label: 'Undo', onClick: () => {} } })
  fireEvent.focusIn(screen.getByRole('button', { name: 'Undo' }))
  passed(10000)
  expect(shown('Deleted')).toBe(true)
  fireEvent.focusOut(screen.getByRole('button', { name: 'Undo' }))
  passed(6100)
  expect(shown('Deleted')).toBe(false)
})

test('a pointer over the toasts stops the timer', () => {
  render(<Toaster />)
  show({ message: 'Saved' })
  fireEvent.pointerMove(screen.getByRole('region'))
  passed(10000)
  expect(shown('Saved')).toBe(true)
})

// Toasts shown while a modal is open must not end up under it, and must stay clickable.
test('toasts sit above every other layer and take clicks over a modal', () => {
  const { scale } = parseTokens(tokensCss)
  const z = (name: string) => Number(scale.find(t => t.name === name)?.value)
  expect(z('--z-modal')).toBeGreaterThan(0)
  expect(z('--z-popover')).toBeGreaterThan(z('--z-modal'))
  expect(z('--z-toast')).toBeGreaterThan(z('--z-popover'))
  expect(css).toMatch(/z-index: var\(--z-toast\)/)
  expect(css).toMatch(/\.viewport \{[^}]*pointer-events: auto/)
  expect(css).toMatch(/\.toast \{[^}]*pointer-events: auto !important/)
})
