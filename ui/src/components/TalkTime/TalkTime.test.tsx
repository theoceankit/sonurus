import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { TalkTime } from './TalkTime'

const SEGMENTS = [
  { id: 'a', name: 'Anna', color: 5, seconds: 19 },
  { id: 'b', name: 'Mark', color: 1, seconds: 11 },
] as const

test('shows the total and one segment per speaker', () => {
  const { container } = render(<TalkTime total="0:30" segments={SEGMENTS} />)
  expect(screen.getByText('0:30')).toBeTruthy()
  expect(container.querySelectorAll('[data-segment]')).toHaveLength(2)
})

test('a segment grows with the speech and has the colour of the speaker', () => {
  const { container } = render(<TalkTime total="0:30" segments={SEGMENTS} />)
  const first = container.querySelector<HTMLElement>('[data-segment]')!
  expect(first.style.flexGrow).toBe('19')
  expect(first.style.background).toContain('--color-speaker-5-mid')
})

test('there is no limit of six', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ id: String(i), name: String(i), color: 1 as const, seconds: 1 }))
  const { container } = render(<TalkTime total="0:09" segments={many} />)
  expect(container.querySelectorAll('[data-segment]')).toHaveLength(9)
})

test('says who is in it to assistive technology', () => {
  render(<TalkTime total="0:30" segments={SEGMENTS} />)
  expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Talk time: Anna, Mark')
})
