import { expect, test } from 'vitest'
import { GRAY_COLOR_INDEX, hasSpeakerNamed, leastUsedColorIndex } from './new-speaker'

test('leastUsedColorIndex: first palette color no speaker uses', () => {
  expect(leastUsedColorIndex([])).toBe(0)
  expect(leastUsedColorIndex([{ color_index: 0 }, { color_index: 1 }])).toBe(2)
})

test('leastUsedColorIndex: all used, the least used one, lowest index on ties', () => {
  const rows = [0, 0, 1, 2, 2, 3, 4, 4].map(color_index => ({ color_index }))
  expect(leastUsedColorIndex(rows)).toBe(1)
})

test('leastUsedColorIndex: gray is never offered, it stands for an unknown speaker', () => {
  const rows = [0, 1, 2, 3, 4].map(color_index => ({ color_index }))
  expect(leastUsedColorIndex(rows)).toBe(0)
  expect(leastUsedColorIndex(rows)).not.toBe(GRAY_COLOR_INDEX)
})

test('hasSpeakerNamed: ignores case and surrounding spaces', () => {
  const rows = [{ id: 'a', name: 'Alice Smith' }, { id: 'u', name: null }]
  expect(hasSpeakerNamed(rows, '  alice SMITH ')).toBe(true)
  expect(hasSpeakerNamed(rows, 'Alice')).toBe(false)
  expect(hasSpeakerNamed(rows, '   ')).toBe(false)
})
