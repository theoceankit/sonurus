import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { PanelResizer } from './PanelResizer'

beforeEach(() => { HTMLElement.prototype.setPointerCapture = vi.fn() })

function setup() {
  const handlers = { onResize: vi.fn(), onResizeEnd: vi.fn(), onResizeCancel: vi.fn() }
  render(<PanelResizer label="Resize" {...handlers} />)
  return { ...handlers, gap: screen.getByRole('separator', { name: 'Resize' }) }
}

test('a drag reports the travel from the press and ends once', () => {
  const { gap, onResize, onResizeEnd } = setup()
  fireEvent.pointerDown(gap, { pointerId: 1, button: 0, clientX: 500 })
  fireEvent.pointerMove(gap, { pointerId: 1, clientX: 460 })
  fireEvent.pointerMove(gap, { pointerId: 1, clientX: 430 })
  fireEvent.pointerUp(gap, { pointerId: 1, clientX: 430 })
  expect(onResize.mock.calls).toEqual([[-40], [-70]])
  expect(onResizeEnd).toHaveBeenCalledTimes(1)
})

test('a click without a move changes nothing', () => {
  const { gap, onResize, onResizeEnd } = setup()
  fireEvent.pointerDown(gap, { pointerId: 1, button: 0, clientX: 500 })
  fireEvent.pointerUp(gap, { pointerId: 1, clientX: 500 })
  expect(onResize).not.toHaveBeenCalled()
  expect(onResizeEnd).not.toHaveBeenCalled()
})

test('another mouse button does not drag', () => {
  const { gap, onResize } = setup()
  fireEvent.pointerDown(gap, { pointerId: 1, button: 2, clientX: 500 })
  fireEvent.pointerMove(gap, { pointerId: 1, clientX: 460 })
  expect(onResize).not.toHaveBeenCalled()
})

test('a cancelled drag goes back and saves nothing', () => {
  const { gap, onResizeEnd, onResizeCancel } = setup()
  fireEvent.pointerDown(gap, { pointerId: 1, button: 0, clientX: 500 })
  fireEvent.pointerMove(gap, { pointerId: 1, clientX: 460 })
  fireEvent.pointerCancel(gap, { pointerId: 1 })
  expect(onResizeCancel).toHaveBeenCalledTimes(1)
  expect(onResizeEnd).not.toHaveBeenCalled()
})
