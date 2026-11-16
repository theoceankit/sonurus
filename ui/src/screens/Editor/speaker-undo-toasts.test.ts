import { expect, test, vi } from 'vitest'
import { dismissUndoToastsOf, trackUndoToast } from './speaker-undo-toasts'

test('closes the toasts whose Undo would bring the speaker back, and only once', () => {
  const first = vi.fn()
  const second = vi.fn()
  const other = vi.fn()
  trackUndoToast(['a'], first)
  trackUndoToast(['b', 'a'], second)
  trackUndoToast(['c'], other)
  dismissUndoToastsOf('a')
  dismissUndoToastsOf('a')
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenCalledTimes(1)
  expect(other).not.toHaveBeenCalled()
  dismissUndoToastsOf('c')
})

test('a toast whose Undo was used is not closed again', () => {
  const dismiss = vi.fn()
  const forget = trackUndoToast(['a'], dismiss)
  forget()
  dismissUndoToastsOf('a')
  expect(dismiss).not.toHaveBeenCalled()
})
