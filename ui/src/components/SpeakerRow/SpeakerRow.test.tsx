import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { SpeakerRow } from './SpeakerRow'
import css from './SpeakerRow.module.css?raw'

const ANNA = { name: 'Anna Petrova', color: 5 } as const

test('shows the avatar, the name and the time', () => {
  render(<SpeakerRow speaker={ANNA} time="0:19" />)
  expect(screen.getByText('AP')).toBeTruthy()
  expect(screen.getByText('Anna Petrova')).toBeTruthy()
  expect(screen.getByText('0:19')).toBeTruthy()
})

test('with nothing to do it is no button', () => {
  render(<SpeakerRow speaker={ANNA} time="0:19" />)
  expect(screen.queryByRole('button')).toBeNull()
})

test('a click opens the speaker, and no button sits inside a button', async () => {
  const onSelect = vi.fn()
  const { container } = render(<SpeakerRow speaker={ANNA} time="0:19" onSelect={onSelect} onPlay={() => {}} onAssign={() => {}} />)
  await userEvent.click(screen.getByText('Anna Petrova'))
  expect(onSelect).toHaveBeenCalledOnce()
  expect(container.querySelector('button button')).toBeNull()
})

test('selected: says so, and the name is strong', () => {
  render(<SpeakerRow speaker={ANNA} time="0:19" selected onSelect={() => {}} />)
  expect(screen.getByRole('button', { name: /Anna Petrova/ }).getAttribute('aria-current')).toBe('true')
})

test('the buttons call back and do not open the speaker', async () => {
  const handlers = { onSelect: vi.fn(), onPlay: vi.fn(), onAssign: vi.fn() }
  render(<SpeakerRow speaker={ANNA} time="0:19" {...handlers} />)
  await userEvent.click(screen.getByRole('button', { name: 'Play Anna Petrova' }))
  await userEvent.click(screen.getByRole('button', { name: 'Assign Anna Petrova' }))
  expect(handlers.onPlay).toHaveBeenCalledOnce()
  expect(handlers.onAssign).toHaveBeenCalledOnce()
  expect(handlers.onSelect).not.toHaveBeenCalled()
})

test('playing: the button pauses', () => {
  render(<SpeakerRow speaker={ANNA} time="0:19" playing onPlay={() => {}} />)
  expect(screen.getByRole('button', { name: 'Pause Anna Petrova' })).toBeTruthy()
})

test('only what is passed gets a button', () => {
  render(<SpeakerRow speaker={{ kind: 'unassigned', name: 'Unassigned' }} time="0:04" onAssign={() => {}} />)
  expect(screen.getByRole('button', { name: 'Assign Unassigned' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Play Unassigned' })).toBeNull()
})

test('the buttons appear on hover and on focus, in place of the time', () => {
  expect(css).toMatch(/\.speakerRow:not\(\.followsHighlight\):hover \.actions,\s*\.followsHighlight\[data-highlighted\]:hover \.actions,\s*\.speakerRow:focus-within \.actions/)
  expect(css).toMatch(/\.hasActions:not\(\.followsHighlight\):hover \.time,\s*\.hasActions\.followsHighlight\[data-highlighted\]:hover \.time,\s*\.hasActions:focus-within \.time/)
})

// A row whose highlight comes late looks hovered with it, not with the pointer: a
// pointer passing over it changes nothing.
test('a row told whether it is highlighted takes the look of hover from that', () => {
  const { container, rerender } = render(<SpeakerRow speaker={ANNA} time="0:19" onPlay={() => {}} highlighted={false} />)
  const row = container.firstElementChild!
  expect(row.className).toContain('followsHighlight')
  expect(css).toMatch(/\.speakerRow:not\(\.followsHighlight\):hover,\s*\.speakerRow\[data-highlighted\]\s*\{\s*background: var\(--color-fill-hover\)/)
  rerender(<SpeakerRow speaker={ANNA} time="0:19" onPlay={() => {}} />)
  expect(row.className).not.toContain('followsHighlight')
})

test('show more: says how many and toggles', async () => {
  const onToggle = vi.fn()
  const { rerender } = render(<SpeakerRow kind="show-more" count={3} onToggle={onToggle} stack={<i>stack</i>} />)
  const button = screen.getByRole('button', { name: /Show 3 more/ })
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByText('stack')).toBeTruthy()
  await userEvent.click(button)
  expect(onToggle).toHaveBeenCalledOnce()
  rerender(<SpeakerRow kind="show-more" count={3} expanded onToggle={onToggle} stack={<i>stack</i>} />)
  expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true')
  expect(screen.queryByText('stack')).toBeNull()
})

test('highlighted: looks hovered, with no buttons, and a selected row stays pressed', () => {
  const { container, rerender } = render(<SpeakerRow speaker={ANNA} time="0:19" highlighted onPlay={() => {}} onAssign={() => {}} />)
  expect(container.firstElementChild!.hasAttribute('data-highlighted')).toBe(true)
  expect(screen.getByText('0:19')).toBeTruthy()
  rerender(<SpeakerRow speaker={ANNA} time="0:19" onPlay={() => {}} />)
  expect(container.firstElementChild!.hasAttribute('data-highlighted')).toBe(false)
  expect(css.indexOf('[data-highlighted]')).toBeLessThan(css.indexOf('.selected,'))
})

test('show more: can be highlighted for a speaker it hides', () => {
  const { container } = render(<SpeakerRow kind="show-more" count={3} highlighted onToggle={() => {}} />)
  expect(container.firstElementChild!.hasAttribute('data-highlighted')).toBe(true)
})
