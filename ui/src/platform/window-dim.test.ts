import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { holdWindowDim } from './window-dim'

const setWindowDimmed = vi.fn()
// Past the microtask, the frame and the reply.
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 10))

beforeEach(() => {
  vi.stubGlobal('electronAPI', { setWindowDimmed })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0))
})
afterEach(() => {
  vi.unstubAllGlobals()
  setWindowDimmed.mockClear()
})

test('the window is dimmed while something holds it and undimmed after the last lets go', async () => {
  const first = holdWindowDim()
  await settle()
  expect(setWindowDimmed.mock.calls).toEqual([[true, expect.any(Number)]])
  const second = holdWindowDim()
  first()
  await settle()
  expect(setWindowDimmed.mock.calls).toEqual([[true, expect.any(Number)]])
  second()
  await settle()
  expect(setWindowDimmed.mock.calls).toEqual([[true, expect.any(Number)], [false, expect.any(Number)]])
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
  expect(setWindowDimmed.mock.calls).toEqual([[false, expect.any(Number)]])
})

test('letting go twice counts once', async () => {
  const first = holdWindowDim()
  const second = holdWindowDim()
  first()
  first()
  await settle()
  expect(setWindowDimmed.mock.calls).toEqual([[true, expect.any(Number)]])
  second()
  await settle()
  expect(setWindowDimmed.mock.calls).toEqual([[true, expect.any(Number)], [false, expect.any(Number)]])
})

test('the window is told the time of the next frame, when the scrim starts to move', async () => {
  let frame: FrameRequestCallback = () => {}
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
  const release = holdWindowDim()
  await settle()
  expect(setWindowDimmed).not.toHaveBeenCalled()
  frame(500)
  await settle()
  expect(setWindowDimmed.mock.calls).toEqual([[true, performance.timeOrigin + 500]])
  release()
  await settle()
  frame(900)
  await settle()
  expect(setWindowDimmed.mock.calls).toEqual([[true, performance.timeOrigin + 500], [false, performance.timeOrigin + 900]])
})

test('a change before that frame replaces the one waiting', async () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  const release = holdWindowDim()
  await settle()
  release()
  await settle()
  for (const frame of frames) frame(500)
  await settle()
  expect(setWindowDimmed.mock.calls).toEqual([[false, performance.timeOrigin + 500]])
})

test('without Electron nothing happens', async () => {
  vi.stubGlobal('electronAPI', undefined)
  const release = holdWindowDim()
  await settle()
  release()
  await settle()
  expect(setWindowDimmed).not.toHaveBeenCalled()
})
