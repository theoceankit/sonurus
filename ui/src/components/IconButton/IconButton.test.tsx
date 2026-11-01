import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { expect, test, vi } from 'vitest'
import { IconButton } from './IconButton'

test('is named by its label and does not submit forms', () => {
  render(<IconButton icon="add" label="Add speaker" />)
  expect(screen.getByRole('button', { name: 'Add speaker' }).getAttribute('type')).toBe('button')
})

test('a toggle says whether it is on, a plain button says nothing', () => {
  const { rerender } = render(<IconButton icon="pin" label="Pin" />)
  expect(screen.getByRole('button').hasAttribute('aria-pressed')).toBe(false)

  rerender(<IconButton icon="pin" label="Pin" selected={false} />)
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')

  rerender(<IconButton icon="pin" label="Pin" selected />)
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
})

test('calls onClick, and does not when disabled', () => {
  const onClick = vi.fn()
  const { rerender } = render(<IconButton icon="add" label="Add" onClick={onClick} />)
  fireEvent.click(screen.getByRole('button'))
  expect(onClick).toHaveBeenCalledTimes(1)
  rerender(<IconButton icon="add" label="Add" onClick={onClick} disabled />)
  fireEvent.click(screen.getByRole('button'))
  expect(onClick).toHaveBeenCalledTimes(1)
})

test.each([
  ['xs', 12], ['small', 16], ['medium', 16],
] as const)('size %s draws a %i px icon', (size, px) => {
  const { container } = render(<IconButton icon="add" label="Add" size={size} />)
  expect(container.querySelector('svg')?.getAttribute('class')).toMatch(new RegExp(`size${px}`))
})

test('inverse is large with a 20 px icon by default', () => {
  const { container } = render(<IconButton variant="inverse" icon="play" label="Play" />)
  expect(screen.getByRole('button').className).toMatch(/\blarge\b/)
  expect(container.querySelector('svg')?.getAttribute('class')).toMatch(/size20/)
})

test('passes the ref and other attributes to the button', () => {
  const ref = createRef<HTMLButtonElement>()
  render(<IconButton ref={ref} icon="add" label="Add" data-state="open" />)
  expect(ref.current?.dataset.state).toBe('open')
})

test('pairs that do not exist in the design are type errors', () => {
  const pairs = () => [
    // @ts-expect-error a label is required
    <IconButton icon="add" />,
    // @ts-expect-error secondary has no xs
    <IconButton variant="secondary" size="xs" icon="add" label="A" />,
    // @ts-expect-error primary has no medium
    <IconButton variant="primary" size="medium" icon="add" label="A" />,
    // @ts-expect-error inverse is only large
    <IconButton variant="inverse" size="small" icon="add" label="A" />,
    // @ts-expect-error only ghost toggles
    <IconButton variant="primary" selected icon="add" label="A" />,
  ]
  expect(pairs).toBeTypeOf('function')
})
