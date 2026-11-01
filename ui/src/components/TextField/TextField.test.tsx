import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { expect, test, vi } from 'vitest'
import { TextField } from './TextField'

test('the label names the input and a click on it focuses the input', async () => {
  render(<TextField label="Name" />)
  await userEvent.click(screen.getByText('Name'))
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }))
})

test('no label row without a label; aria-label names the field then', () => {
  const { container } = render(<TextField aria-label="Name" />)
  expect(container.querySelector('label')).toBeNull()
  expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy()
})

test('shows the optional mark and the prefix only when asked', () => {
  const { rerender } = render(<TextField label="Handle" />)
  expect(screen.queryByText('Optional')).toBeNull()
  expect(screen.queryByText('@')).toBeNull()
  rerender(<TextField label="Handle" optional prefix="@" />)
  expect(screen.getByText('Optional')).toBeTruthy()
  expect(screen.getByText('@')).toBeTruthy()
})

test('a helper describes the field', () => {
  render(<TextField label="Name" helper="As shown in transcripts" />)
  const input = screen.getByRole('textbox')
  expect(input.getAttribute('aria-invalid')).toBeNull()
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('As shown in transcripts')
})

test('an error replaces the helper and marks the field invalid', () => {
  render(<TextField label="Name" helper="As shown in transcripts" error="Enter a name" />)
  const input = screen.getByRole('textbox')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(screen.queryByText('As shown in transcripts')).toBeNull()
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Enter a name')
})

test('no description without a message', () => {
  render(<TextField label="Name" />)
  expect(screen.getByRole('textbox').hasAttribute('aria-describedby')).toBe(false)
})

test('disabled takes no input', async () => {
  const onChange = vi.fn()
  render(<TextField label="Name" disabled onChange={onChange} />)
  await userEvent.type(screen.getByRole('textbox'), 'a')
  expect(onChange).not.toHaveBeenCalled()
})

test('has no reaction of its own to Escape: the event goes on and the value stays', () => {
  const onKeyDown = vi.fn()
  render(<div onKeyDown={onKeyDown}><TextField label="Name" defaultValue="Anna" /></div>)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
  expect(onKeyDown).toHaveBeenCalledTimes(1)
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Anna')
})

test('passes the ref and other attributes to the input', () => {
  const ref = createRef<HTMLInputElement>()
  render(<TextField ref={ref} label="Name" maxLength={10} />)
  expect(ref.current?.maxLength).toBe(10)
})
