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

test('horizontal: arrow keys move by its step, the value is read as given, letting go commits', () => {
  const onChange = vi.fn()
  const onCommit = vi.fn()
  render(<Slider label="Interface scale" orientation="horizontal" min={50} max={200} step={5} value={100} onChange={onChange} onCommit={onCommit} valueText={v => `${v}%`} />)
  const thumb = screen.getByRole('slider', { name: 'Interface scale' })
  expect(thumb.getAttribute('aria-orientation')).toBe('horizontal')
  expect(thumb.getAttribute('aria-valuetext')).toBe('100%')
  fireEvent.keyDown(thumb, { key: 'ArrowRight' })
  expect(onChange).toHaveBeenCalledWith(105)
  expect(onCommit).toHaveBeenCalledWith(105)
})

test('marks show under a horizontal track, the ends inside its width', () => {
  const marks = [50, 100, 150, 200].map(value => ({ value, label: `${value}%` }))
  render(<Slider label="Interface scale" orientation="horizontal" min={50} max={200} step={5} value={100} marks={marks} />)
  expect(screen.getByText('50%').dataset.edge).toBe('start')
  expect(screen.getByText('200%').dataset.edge).toBe('end')
  expect(parseFloat(screen.getByText('100%').style.left)).toBeCloseTo(100 / 3)
})
