import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
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

test('variant and size become classes, small-only variants need no size', () => {
  const { rerender } = render(<Button variant="danger" size="small">Delete</Button>)
  expect(screen.getByRole('button').className).toMatch(/\bdanger\b/)
  expect(screen.getByRole('button').className).toMatch(/\bsmall\b/)

  rerender(<Button variant="toolbar">Copy</Button>)
  expect(screen.getByRole('button').className).toMatch(/\bsmall\b/)

  rerender(<Button>Save</Button>)
  expect(screen.getByRole('button').className).toMatch(/\bmedium\b/)
})

test('a loading button stays focusable, says it is busy and ignores clicks', () => {
  const onClick = vi.fn()
  render(<Button loading onClick={onClick}>Save</Button>)
  const button = screen.getByRole('button', { name: 'Save' })
  expect(button.getAttribute('aria-busy')).toBe('true')
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect((button as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(button)
  expect(onClick).not.toHaveBeenCalled()
})

test('the spinner replaces the icon while loading', () => {
  const { container, rerender } = render(<Button icon="copy">Copy</Button>)
  expect(container.querySelector('svg')).not.toBeNull()
  rerender(<Button icon="copy" loading>Copy</Button>)
  expect(container.querySelector('svg')).toBeNull()
})

test('record shows the timer next to what a click does', () => {
  render(<Button variant="record" timer="0:42">Stop</Button>)
  expect(screen.getByRole('button').textContent).toBe('0:42 Stop')
})

test('passes the ref and other attributes to the button', () => {
  const ref = createRef<HTMLButtonElement>()
  render(<Button ref={ref} data-state="open" type="submit">Save</Button>)
  expect(ref.current?.dataset.state).toBe('open')
  expect(ref.current?.type).toBe('submit')
})

test('pairs that do not exist in the design are type errors', () => {
  const pairs = () => [
    // @ts-expect-error toolbar is only small
    <Button variant="toolbar" size="medium">A</Button>,
    // @ts-expect-error inverse is only small
    <Button variant="inverse" size="medium">A</Button>,
    // @ts-expect-error inverse has no loading state
    <Button variant="inverse" loading>A</Button>,
    // @ts-expect-error record has no loading state
    <Button variant="record" timer="0:42" loading>A</Button>,
    // @ts-expect-error record needs a timer
    <Button variant="record">A</Button>,
  ]
  expect(pairs).toBeTypeOf('function')
})
