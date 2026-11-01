import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { SearchField } from './SearchField'

function Field({ initial = '', onChange = () => {}, ...props }: { initial?: string; onChange?: (v: string) => void; disabled?: boolean; shortcut?: string[]; error?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <SearchField
      aria-label="Search speakers"
      value={value}
      onValueChange={next => {
        setValue(next)
        onChange(next)
      }}
      {...props}
    />
  )
}

const input = () => screen.getByRole('searchbox', { name: 'Search speakers' }) as HTMLInputElement
const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach(fn => fn()))

// Listens the way Radix does for its layers: on the document, going down.
function escapeOnDocument() {
  const heard = vi.fn()
  const listener = (event: KeyboardEvent) => {
    if (event.key === 'Escape') heard()
  }
  document.addEventListener('keydown', listener, { capture: true })
  cleanups.push(() => document.removeEventListener('keydown', listener, { capture: true }))
  return heard
}

test('typing reports the value', async () => {
  const onChange = vi.fn()
  render(<Field onChange={onChange} />)
  await userEvent.type(input(), 'An')
  expect(onChange).toHaveBeenLastCalledWith('An')
})

test('Escape in a filled field clears it and goes no further', async () => {
  const heard = escapeOnDocument()
  render(<Field initial="Anna" />)
  await userEvent.click(input())
  await userEvent.keyboard('{Escape}')
  expect(input().value).toBe('')
  expect(heard).not.toHaveBeenCalled()
})

test('Escape in an empty field goes on to whatever is around it', async () => {
  const heard = escapeOnDocument()
  render(<Field />)
  await userEvent.click(input())
  await userEvent.keyboard('{Escape}')
  expect(heard).toHaveBeenCalledTimes(1)
})

test('the first Escape clears, the second goes on', async () => {
  const heard = escapeOnDocument()
  render(<Field initial="Anna" />)
  await userEvent.click(input())
  await userEvent.keyboard('{Escape}{Escape}')
  expect(input().value).toBe('')
  expect(heard).toHaveBeenCalledTimes(1)
})

test('Escape elsewhere on the page does not clear the field', async () => {
  const heard = escapeOnDocument()
  render(<><Field initial="Anna" /><button>Other</button></>)
  await userEvent.click(screen.getByText('Other'))
  await userEvent.keyboard('{Escape}')
  expect(input().value).toBe('Anna')
  expect(heard).toHaveBeenCalledTimes(1)
})

test('the clear button is there only when filled, clears and returns focus', async () => {
  const { rerender } = render(<Field />)
  expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()

  rerender(<Field key="filled" initial="Anna" />)
  await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(input().value).toBe('')
  expect(document.activeElement).toBe(input())
  expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
})

test('the shortcut hint shows only while empty', async () => {
  const { container } = render(<Field shortcut={['mod', 'K']} />)
  expect(container.querySelector('kbd')).not.toBeNull()
  await userEvent.type(input(), 'A')
  expect(container.querySelector('kbd')).toBeNull()
})

test('an error is shown and marks the field invalid', () => {
  render(<Field error="Search failed, try again" />)
  expect(screen.getByText('Search failed, try again')).toBeTruthy()
  expect(input().getAttribute('aria-invalid')).toBe('true')
})

test('disabled: no typing, no clearing, Escape goes on', async () => {
  const heard = escapeOnDocument()
  render(<Field initial="Anna" disabled />)
  expect((screen.getByRole('button', { name: 'Clear search' }) as HTMLButtonElement).disabled).toBe(true)
  await userEvent.type(input(), 'x')
  expect(input().value).toBe('Anna')
  await userEvent.keyboard('{Escape}')
  expect(input().value).toBe('Anna')
  expect(heard).toHaveBeenCalledTimes(1)
})
