import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Slider } from './Slider'

test('reads its label and value', () => {
  render(<Slider label="Volume" value={0.5} />)
  const thumb = screen.getByRole('slider', { name: 'Volume' })
  expect(thumb.getAttribute('aria-valuenow')).toBe('0.5')
  expect(thumb.getAttribute('aria-orientation')).toBe('vertical')
})

test('arrow keys change the value by a step', () => {
  const onChange = vi.fn()
  render(<Slider label="Volume" value={0.5} onChange={onChange} />)
  fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' })
  expect(onChange).toHaveBeenCalledWith(0.52)
})

test('a disabled slider does not take changes', () => {
  const onChange = vi.fn()
  render(<Slider label="Volume" value={0.5} onChange={onChange} disabled />)
  fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' })
  expect(onChange).not.toHaveBeenCalled()
})
