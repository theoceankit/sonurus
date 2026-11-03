import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { holdWindowDim } from './window-dim'

const setWindowDimmed = vi.fn()
const settle = () => new Promise<void>(resolve => queueMicrotask(resolve))

beforeEach(() => vi.stubGlobal('electronAPI', { setWindowDimmed }))
afterEach(() => {
  vi.unstubAllGlobals()
  setWindowDimmed.mockClear()
})

test('the window is dimmed while something holds it and undimmed after the last lets go', async () => {
  const first = holdWindowDim()
  await settle()
  expect(setWindowDimmed.mock.calls).toEqual([[true]])
  const second = holdWindowDim()
  first()
  await settle()
  expect(setWindowDimmed.mock.calls).toEqual([[true]])
  second()
  await settle()
  expect(setWindowDimmed.mock.calls).toEqual([[true], [false]])
})

test('letting go and holding again at once says nothing', async () => {
  const first = holdWindowDim()
  await settle()
  setWindowDimmed.mockClear()
  first()
  const second = holdWindowDim()
  await settle()
  expect(setWindowDimmed).not.toHaveBeenCalled()
  second()
  await settle()
  expect(setWindowDimmed.mock.calls).toEqual([[false]])
})

test('letting go twice counts once', async () => {
  const first = holdWindowDim()
  const second = holdWindowDim()
  first()
  first()
  await settle()
  expect(setWindowDimmed.mock.calls).toEqual([[true]])
  second()
  await settle()
  expect(setWindowDimmed.mock.calls).toEqual([[true], [false]])
})

test('without Electron nothing happens', async () => {
  vi.stubGlobal('electronAPI', undefined)
  const release = holdWindowDim()
  await settle()
  release()
  await settle()
  expect(setWindowDimmed).not.toHaveBeenCalled()
})
