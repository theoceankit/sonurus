import { renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import { useKeepRowInPlace } from './useKeepRowInPlace'

// `tops` is where the row stands in each version of the data, with no scrolling. The
// new layout comes after the render, as it does in the app.
function setup(tops: Record<number, number>) {
  const area = document.createElement('div')
  area.getBoundingClientRect = () => ({ top: 50, bottom: 650 }) as DOMRect
  const row = document.createElement('div')
  row.dataset.segmentStart = '8.5'
  let layout = tops[1]
  row.getBoundingClientRect = () => ({ top: layout - area.scrollTop }) as DOMRect
  area.append(row)
  const hook = renderHook(({ version }) => {
    const keep = useKeepRowInPlace(area, version)
    layout = tops[version]
    return keep
  }, { initialProps: { version: 1 } })
  return { area, row, ...hook }
}

test('the row asked for stays where it was when the data changes', () => {
  const { area, result, rerender } = setup({ 1: 300, 2: 344 })
  result.current(8.5)
  rerender({ version: 2 })
  expect(area.scrollTop).toBe(44)
})

test('it works the other way too, when a header goes away', () => {
  const { area, result, rerender } = setup({ 1: 300, 2: 344, 3: 300 })
  result.current(8.5)
  rerender({ version: 2 })
  rerender({ version: 3 })
  expect(area.scrollTop).toBe(0)
})

test('with no row asked for, nothing moves', () => {
  const { area, rerender } = setup({ 1: 300, 2: 344 })
  rerender({ version: 2 })
  expect(area.scrollTop).toBe(0)
})

test('a row out of sight is left alone', () => {
  const { area, result, rerender } = setup({ 1: 900, 2: 944 })
  result.current(8.5)
  rerender({ version: 2 })
  expect(area.scrollTop).toBe(0)
})

test('a row that is gone is left alone', () => {
  const { area, row, result, rerender } = setup({ 1: 300, 2: 344 })
  result.current(8.5)
  row.remove()
  rerender({ version: 2 })
  expect(area.scrollTop).toBe(0)
})
