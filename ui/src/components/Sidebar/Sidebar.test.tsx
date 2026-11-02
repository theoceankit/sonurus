import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Sidebar, type SidebarSection } from './Sidebar'

const recording = (id: number, title: string) => ({ id, title, speakers: [], needsReview: false })
const SECTIONS: SidebarSection[] = [
  { title: 'This week', recordings: [recording(1, 'Design review'), recording(2, 'Call with Mark')] },
  { title: 'Earlier', recordings: [recording(3, 'Quarterly numbers')] },
]

test('shows the sections in order with their recordings', () => {
  render(<Sidebar sections={SECTIONS} />)
  const [week, earlier] = screen.getAllByRole('region')
  expect(within(week).getByText('This week')).toBeTruthy()
  expect(within(week).getAllByRole('button')).toHaveLength(2)
  expect(within(earlier).getByRole('button', { name: /Quarterly numbers/ })).toBeTruthy()
})

test('a click selects the recording', async () => {
  const onSelect = vi.fn()
  render(<Sidebar sections={SECTIONS} onSelect={onSelect} />)
  await userEvent.click(screen.getByRole('button', { name: /Call with Mark/ }))
  expect(onSelect).toHaveBeenCalledWith(2)
})

test('marks the selected recording only', () => {
  render(<Sidebar sections={SECTIONS} selectedId={3} />)
  const current = screen.getAllByRole('button').filter(b => b.getAttribute('aria-current'))
  expect(current.map(b => b.textContent)).toEqual(['Quarterly numbers'])
})

test('loading shows nothing at all', () => {
  render(<Sidebar state="loading" />)
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByText('No recordings yet')).toBeNull()
})

test('an empty list says so', () => {
  render(<Sidebar />)
  expect(screen.getByText('No recordings yet')).toBeTruthy()
})

test('an error offers a retry', async () => {
  const onRetry = vi.fn()
  render(<Sidebar state="error" onRetry={onRetry} />)
  expect(screen.getByText('Could not load recordings')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(onRetry).toHaveBeenCalledOnce()
})
