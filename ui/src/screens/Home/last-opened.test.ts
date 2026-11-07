import { expect, test } from 'vitest'
import type { TranscriptListItem } from '../../api/types'
import { pickRecording, RECENT_LIMIT, rememberOpened } from './last-opened'

const list = (...ids: number[]) => ids.map(id => ({ id }) as TranscriptListItem)

test('the last one opened, when it is still there', () => {
  expect(pickRecording(list(1, 2, 3), [2, 3])).toBe(2)
})

test('the one opened before it, when the last one is gone', () => {
  expect(pickRecording(list(1, 2, 3), [9, 3, 2])).toBe(3)
})

test('the newest, first in the list, when none of those opened is left', () => {
  expect(pickRecording(list(5, 4), [9, 8])).toBe(5)
  expect(pickRecording(list(5, 4), [])).toBe(5)
})

test('none for an empty list', () => {
  expect(pickRecording([], [1])).toBeNull()
})

test('the one opened goes first, once', () => {
  expect(rememberOpened([3, 2, 1], 2)).toEqual([2, 3, 1])
  expect(rememberOpened([], 7)).toEqual([7])
})

test('only the last ones are kept', () => {
  const many = Array.from({ length: RECENT_LIMIT }, (_, i) => i)
  expect(rememberOpened(many, 100)).toEqual([100, ...many.slice(0, RECENT_LIMIT - 1)])
})
