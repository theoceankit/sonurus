import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Button } from './Button'

test('renders its label and does not submit forms by default', () => {
  render(<Button>Save</Button>)
  expect(screen.getByRole('button', { name: 'Save' }).getAttribute('type')).toBe('button')
})

test('calls onClick, and does not when disabled', () => {
  const onClick = vi.fn()
  const { rerender } = render(<Button onClick={onClick}>Save</Button>)
  fireEvent.click(screen.getByRole('button'))
  expect(onClick).toHaveBeenCalledTimes(1)

  rerender(<Button onClick={onClick} disabled>Save</Button>)
  fireEvent.click(screen.getByRole('button'))
  expect(onClick).toHaveBeenCalledTimes(1)
})
