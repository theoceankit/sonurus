import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { TalkTime } from './TalkTime'
import css from './TalkTime.module.css?raw'

const SEGMENTS = [
  { id: 'a', name: 'Anna', color: 5, seconds: 19, time: '0:19' },
  { id: 'b', name: 'Mark', color: 1, seconds: 11, time: '0:11' },
] as const

test('shows the total and one segment per speaker', () => {
  const { container } = render(<OverlayProvider><TalkTime total="0:30" segments={SEGMENTS} /></OverlayProvider>)
  expect(screen.getByText('0:30')).toBeTruthy()
  expect(container.querySelectorAll('[data-segment]')).toHaveLength(2)
})

test('a segment grows with the speech and has the colour of the speaker', () => {
  const { container } = render(<OverlayProvider><TalkTime total="0:30" segments={SEGMENTS} /></OverlayProvider>)
  const first = container.querySelector<HTMLElement>('[data-segment]')!
  expect(first.style.flexGrow).toBe('19')
  expect(first.style.background).toContain('--color-speaker-5-mid')
})

test('there is no limit of six', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ id: String(i), name: String(i), color: 1 as const, seconds: 1, time: '0:01' }))
  const { container } = render(<OverlayProvider><TalkTime total="0:09" segments={many} /></OverlayProvider>)
  expect(container.querySelectorAll('[data-segment]')).toHaveLength(9)
})

test('says who is in it to assistive technology', () => {
  render(<OverlayProvider><TalkTime total="0:30" segments={SEGMENTS} /></OverlayProvider>)
  expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Talk time: Anna, Mark')
})

const pieces = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-segment]')]

test('the pointer over a segment reports its speaker, and leaving the bar reports none', () => {
  const onHighlight = vi.fn()
  const { container } = render(<OverlayProvider><TalkTime total="0:30" segments={SEGMENTS} onHighlight={onHighlight} /></OverlayProvider>)
  fireEvent.pointerEnter(pieces(container)[1])
  expect(onHighlight).toHaveBeenLastCalledWith('b')
  fireEvent.pointerLeave(container.querySelector('[role="img"]')!)
  expect(onHighlight).toHaveBeenLastCalledWith(null)
})

test('highlighted: that speaker keeps the middle tone and the others take the light one', () => {
  const { container } = render(<OverlayProvider><TalkTime total="0:30" segments={SEGMENTS} highlightedId="b" /></OverlayProvider>)
  expect(pieces(container).map(piece => piece.style.background)).toEqual(['var(--color-speaker-5-bg)', 'var(--color-speaker-1-mid)'])
})

test('a highlight of someone not in the bar changes nothing', () => {
  const { container } = render(<OverlayProvider><TalkTime total="0:30" segments={SEGMENTS} highlightedId="x" /></OverlayProvider>)
  expect(pieces(container).map(piece => piece.style.background)).toEqual(['var(--color-speaker-5-mid)', 'var(--color-speaker-1-mid)'])
})

test('a segment names its speaker and their time in a tooltip', async () => {
  const { container } = render(<OverlayProvider><TalkTime total="0:30" segments={SEGMENTS} /></OverlayProvider>)
  await userEvent.hover(pieces(container)[0])
  expect((await screen.findByRole('tooltip')).textContent).toContain('Anna 0:19')
})

// A segment may be 2 px wide and the bar is 6 px high: the pointer must not fall
// between them on its way.
test('a segment takes the pointer over the gaps and above and below the bar', () => {
  expect(css).toMatch(/\.segment::before \{[^}]*inset: calc\(var\(--space-1\) \* -1\) calc\(var\(--space-half\) \/ -2\)/)
})
