import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ClipPlayer } from './ClipPlayer'

test('shows the duration, and play or pause', () => {
  const { rerender } = render(<ClipPlayer progress={0} duration="0:04" />)
  expect(screen.getByText('0:04')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Play clip' })).toBeTruthy()
  rerender(<ClipPlayer progress={0} duration="0:04" playing />)
  expect(screen.getByRole('button', { name: 'Pause clip' })).toBeTruthy()
})

test('play calls back', async () => {
  const onToggle = vi.fn()
  render(<ClipPlayer progress={0} duration="0:04" onToggle={onToggle} />)
  await userEvent.click(screen.getByRole('button', { name: 'Play clip' }))
  expect(onToggle).toHaveBeenCalledOnce()
})

test('with nothing to play the button does nothing', async () => {
  const onToggle = vi.fn()
  render(<ClipPlayer progress={0} duration="0:04" disabled onToggle={onToggle} />)
  await userEvent.click(screen.getByRole('button', { name: 'Play clip' }))
  expect(onToggle).not.toHaveBeenCalled()
})

test('the text button is there only when asked, and says its state', async () => {
  const onToggleText = vi.fn()
  const { rerender } = render(<ClipPlayer progress={0} duration="0:04" />)
  expect(screen.queryByRole('button', { name: 'Show text' })).toBeNull()
  rerender(<ClipPlayer progress={0} duration="0:04" onToggleText={onToggleText} />)
  await userEvent.click(screen.getByRole('button', { name: 'Show text' }))
  expect(onToggleText).toHaveBeenCalledOnce()
  rerender(<ClipPlayer progress={0} duration="0:04" onToggleText={onToggleText} textExpanded />)
  expect(screen.getByRole('button', { name: 'Hide text' }).getAttribute('aria-expanded')).toBe('true')
})

test('the waveform takes the heights of the clip, and is flat without them', () => {
  const heightsOf = () =>
    [...screen.getByText('0:04').previousElementSibling!.children].map(bar => (bar as HTMLElement).style.height)
  const { rerender } = render(<ClipPlayer progress={0} duration="0:04" />)
  expect(new Set(heightsOf()).size).toBe(1)
  rerender(<ClipPlayer progress={0} duration="0:04" heights={[0, 0.5, 1]} />)
  expect(heightsOf()).toEqual(['0%', '50%', '100%'])
})
