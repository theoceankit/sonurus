import { act, render, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { expect, test, vi } from 'vitest'
import { ExitSignal, useLingering } from './presence'

const a = { name: 'a' }
const b = { name: 'b' }

test('keeps the last value while the way out plays', () => {
  const { result, rerender } = renderHook(({ value }) => useLingering(value), { initialProps: { value: a as typeof a | null } })
  expect(result.current).toMatchObject({ value: a, open: true })
  rerender({ value: null })
  expect(result.current).toMatchObject({ value: a, open: false })
  act(() => result.current.exited())
  expect(result.current).toMatchObject({ value: null, open: false })
})

test('exited does nothing while a value is there, drop takes it away at once', () => {
  const { result, rerender } = renderHook(({ value }) => useLingering(value), { initialProps: { value: a as typeof a | null } })
  act(() => result.current.exited())
  expect(result.current).toMatchObject({ value: a, open: true })
  rerender({ value: null })
  act(() => result.current.drop())
  expect(result.current.value).toBeNull()
})

test('a new value gets a new key, also during the way out', () => {
  const { result, rerender } = renderHook(({ value }) => useLingering(value), { initialProps: { value: a as typeof a | null } })
  const first = result.current.key
  rerender({ value: null })
  rerender({ value: b })
  expect(result.current).toMatchObject({ value: b, open: true })
  expect(result.current.key).not.toBe(first)
})

test('the same value again keeps its key', () => {
  const { result, rerender } = renderHook(({ value }) => useLingering(value), { initialProps: { value: a as typeof a | null } })
  const first = result.current.key
  rerender({ value: a })
  expect(result.current.key).toBe(first)
})

test('ExitSignal fires on the real unmount only', async () => {
  const onExited = vi.fn()
  const { unmount } = render(<StrictMode><ExitSignal onExited={onExited} /></StrictMode>)
  await Promise.resolve()
  expect(onExited).not.toHaveBeenCalled()
  unmount()
  await waitFor(() => expect(onExited).toHaveBeenCalledOnce())
})
