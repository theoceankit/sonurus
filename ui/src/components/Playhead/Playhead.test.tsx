import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Playhead } from './Playhead'

test('stands at its share of the waveform', () => {
  const { container } = render(<Playhead position={0.25} />)
  expect((container.firstElementChild as HTMLElement).style.left).toBe('25%')
})

test('the default look has no bubble', () => {
  render(<Playhead position={0} time="00:35" name="Anna" />)
  expect(screen.queryByText('00:35')).toBeNull()
})

test('the hover look shows the time and the name', () => {
  render(<Playhead look="hover" position={0} time="00:35" name="Anna Petrova" />)
  expect(screen.getByText('00:35')).toBeTruthy()
  expect(screen.getByText('Anna Petrova')).toBeTruthy()
})

afterEach(() => vi.restoreAllMocks())

test('the bubble takes the width of its text, and reads it only when that can change', () => {
  const read = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80)
  const { rerender } = render(<Playhead look="hover" position={0.1} time="59:58" name="Anna" />)
  const bubble = () => screen.getByText(/Anna|Unknown/).parentElement!.parentElement as HTMLElement
  expect(bubble().style.width).toBe('80px')
  expect(read).toHaveBeenCalledTimes(1)

  // The pointer moves and the time runs: same width.
  rerender(<Playhead look="hover" position={0.2} time="59:59" name="Anna" />)
  expect(read).toHaveBeenCalledTimes(1)

  // Another speaker, and the hour coming in.
  read.mockReturnValue(120)
  rerender(<Playhead look="hover" position={0.2} time="59:59" name="Unknown speaker 1" />)
  expect(read).toHaveBeenCalledTimes(2)
  rerender(<Playhead look="hover" position={0.2} time="1:00:00" name="Unknown speaker 1" />)
  expect(read).toHaveBeenCalledTimes(3)
  expect(bubble().style.width).toBe('120px')
})

