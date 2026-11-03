import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { RecordingRow } from './RecordingRow'

const speakers = ['Anna Petrova', 'Mark Ellis', 'Lena Kovacs', 'Oliver Grant', 'Priya Shah']
  .map((name, i) => ({ id: name, name, color: 1 as const, title: `${i}` }))

test('shows the title and acts on a click', async () => {
  const onClick = vi.fn()
  render(<RecordingRow title="Weekly product sync" onClick={onClick} />)
  await userEvent.click(screen.getByRole('button', { name: /Weekly product sync/ }))
  expect(onClick).toHaveBeenCalledOnce()
})

test('works from the keyboard', async () => {
  const onClick = vi.fn()
  render(<RecordingRow title="Weekly product sync" onClick={onClick} />)
  await userEvent.tab()
  await userEvent.keyboard('{Enter}')
  await userEvent.keyboard(' ')
  expect(onClick).toHaveBeenCalledTimes(2)
})

test('says which row is selected', () => {
  const { rerender } = render(<RecordingRow title="A" />)
  expect(screen.getByRole('button').getAttribute('aria-current')).toBeNull()
  rerender(<RecordingRow title="A" selected />)
  expect(screen.getByRole('button').getAttribute('aria-current')).toBe('true')
})

test('the dot appears only when the recording needs review', () => {
  const { rerender } = render(<RecordingRow title="A" />)
  expect(screen.queryByRole('img', { name: 'New' })).toBeNull()
  rerender(<RecordingRow title="A" isNew />)
  expect(screen.getByRole('img', { name: 'New' })).toBeTruthy()
})

test('shows three avatars at most, with no count of the rest', () => {
  render(<RecordingRow title="A" speakers={speakers} />)
  expect(screen.getByText('AP')).toBeTruthy()
  expect(screen.getByText('LK')).toBeTruthy()
  expect(screen.queryByText('OG')).toBeNull()
  expect(screen.queryByText('+2')).toBeNull()
})

test('a recording without speakers has no stack', () => {
  render(<RecordingRow title="A" />)
  expect(screen.getByRole('button').querySelector('[class*="stack"]')).toBeNull()
})
