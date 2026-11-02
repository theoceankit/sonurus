import { expect, test } from 'vitest'
import { selectionPoint } from './useTextSelection'

const rect = (left: number, top: number, width: number, height = 18) => ({ left, top, width, height })
const base = { left: 300, top: 100 }

test('the point is the middle of the first selected line, not of the whole selection', () => {
  const lines = [rect(620, 430, 200), rect(370, 454, 120)]
  expect(selectionPoint(lines, base)).toEqual({ x: 420, y: 330 })
})

test('empty rectangles at the start of a selection do not count', () => {
  expect(selectionPoint([rect(370, 400, 0), rect(620, 430, 200)], base)).toEqual({ x: 420, y: 330 })
})

test('a selection too narrow to be meant has no point', () => {
  expect(selectionPoint([rect(620, 430, 3)], base)).toBeNull()
  expect(selectionPoint([], base)).toBeNull()
})
