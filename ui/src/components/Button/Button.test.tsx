import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { expect, test, vi } from 'vitest'
import { Button } from './Button'
import css from './Button.module.css?raw'

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

test('while loading the icon and the label keep their place and the spinner takes none, so the width stays', () => {
  const { container, rerender } = render(<Button loading>Import</Button>)
  const spinner = container.querySelector('.spinner')!
  expect(getComputedStyle(spinner).position).toBe('absolute')
  expect(screen.getByRole('button').textContent).toBe('Import')

  rerender(<Button icon="copy" loading>Copy</Button>)
  expect(container.querySelector('svg')).not.toBeNull()
  expect(getComputedStyle(container.querySelector('.spinner')!).position).toBe('absolute')
})

// jsdom runs no animations, so the end of busy-hide is checked in the source: with
// visibility or display the label would leave the accessibility tree, and a busy
// button would be read out with no name once the spinner shows.
test('a busy button keeps its name: the label is hidden from sight only', () => {
  const hide = css.match(/@keyframes busy-hide \{([\s\S]*?)\n\}/)![1]
  expect(hide).toMatch(/opacity: 0/)
  expect(hide).not.toMatch(/visibility|display/)
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
