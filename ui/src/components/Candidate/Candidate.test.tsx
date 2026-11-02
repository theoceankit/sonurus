import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Candidate } from './Candidate'

const MARK = { name: 'Mark Ellis', color: 1 } as const

test('shows the avatar, the name and the score as a percentage', () => {
  render(<Candidate speaker={MARK} score={0.816} />)
  expect(screen.getByText('ME')).toBeTruthy()
  expect(screen.getByText('Mark Ellis')).toBeTruthy()
  expect(screen.getByText('82%')).toBeTruthy()
})

test('the mark shows only when the API says suggested, whatever the score', () => {
  const { rerender } = render(<Candidate speaker={MARK} score={0.99} />)
  expect(screen.queryByLabelText('Suggested')).toBeNull()
  rerender(<Candidate speaker={MARK} score={0.2} suggested />)
  expect(screen.getByLabelText('Suggested')).toBeTruthy()
})

test('another speaker shows recordings instead', () => {
  render(<Candidate speaker={MARK} usage="8 recordings" />)
  expect(screen.getByText('8 recordings')).toBeTruthy()
})

test('add new: a plus and the label', () => {
  render(<Candidate kind="add">Add a new speaker</Candidate>)
  expect(screen.getByRole('button', { name: 'Add a new speaker' })).toBeTruthy()
})

test('a click calls back', async () => {
  const onClick = vi.fn()
  render(<Candidate speaker={MARK} onClick={onClick} />)
  await userEvent.click(screen.getByRole('button'))
  expect(onClick).toHaveBeenCalledOnce()
})
