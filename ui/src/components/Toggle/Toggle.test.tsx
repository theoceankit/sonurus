import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Toggle } from './Toggle'

test('a switch named by its label, telling whether it is on', () => {
  render(<Toggle label="Timestamps" checked />)
  const toggle = screen.getByRole('switch', { name: 'Timestamps' })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
})

test('a click or Space turns it the other way', async () => {
  const onChange = vi.fn()
  render(<Toggle label="Timestamps" checked={false} onChange={onChange} />)
  await userEvent.click(screen.getByRole('switch'))
  expect(onChange).toHaveBeenLastCalledWith(true)
  await userEvent.keyboard(' ')
  expect(onChange).toHaveBeenCalledTimes(2)
})

test('off when disabled', async () => {
  const onChange = vi.fn()
  render(<Toggle label="Timestamps" checked onChange={onChange} disabled />)
  await userEvent.click(screen.getByRole('switch'))
  expect(onChange).not.toHaveBeenCalled()
})

test('a click stopped before it does nothing', async () => {
  const onChange = vi.fn()
  render(<Toggle label="Timestamps" checked onChange={onChange} onClick={event => event.preventDefault()} />)
  await userEvent.click(screen.getByRole('switch'))
  expect(onChange).not.toHaveBeenCalled()
})
