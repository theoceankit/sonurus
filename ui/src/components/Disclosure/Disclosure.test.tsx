import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Disclosure } from './Disclosure'

const trigger = () => screen.getByRole('button', { name: 'Optional details' })

test('collapsed by default: the content is not there', () => {
  render(<Disclosure label="Optional details">Handle</Disclosure>)
  expect(trigger().getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText('Handle')).toBeNull()
})

test('a click, Enter and Space toggle it', async () => {
  const onExpandedChange = vi.fn()
  render(<Disclosure label="Optional details" onExpandedChange={onExpandedChange}>Handle</Disclosure>)

  await userEvent.click(trigger())
  expect(trigger().getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText('Handle')).toBeTruthy()

  await userEvent.keyboard('{Enter}')
  expect(screen.queryByText('Handle')).toBeNull()

  await userEvent.keyboard(' ')
  expect(screen.getByText('Handle')).toBeTruthy()
  expect(onExpandedChange.mock.calls.map(c => c[0])).toEqual([true, false, true])
})

test('the chevron points right when collapsed and down when expanded', async () => {
  const shapes = () => trigger().querySelector('svg')?.innerHTML
  render(<Disclosure label="Optional details">Handle</Disclosure>)
  const collapsed = shapes()
  await userEvent.click(trigger())
  expect(shapes()).not.toBe(collapsed)
})

test('disabled does not toggle', async () => {
  render(<Disclosure label="Optional details" disabled>Handle</Disclosure>)
  await userEvent.click(trigger())
  expect(screen.queryByText('Handle')).toBeNull()
})

test('a controlled one follows its prop', async () => {
  const onExpandedChange = vi.fn()
  const { rerender } = render(<Disclosure label="Optional details" expanded={false} onExpandedChange={onExpandedChange}>Handle</Disclosure>)
  await userEvent.click(trigger())
  expect(onExpandedChange).toHaveBeenCalledWith(true)
  expect(screen.queryByText('Handle')).toBeNull()

  rerender(<Disclosure label="Optional details" expanded onExpandedChange={onExpandedChange}>Handle</Disclosure>)
  expect(screen.getByText('Handle')).toBeTruthy()
})

test('defaultExpanded starts open', () => {
  render(<Disclosure label="Optional details" defaultExpanded>Handle</Disclosure>)
  expect(screen.getByText('Handle')).toBeTruthy()
})
