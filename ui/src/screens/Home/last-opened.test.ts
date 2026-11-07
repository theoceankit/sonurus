import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { TranscriptListItem } from '../../api/types'
import { createMockElectronAPI } from '../../platform/electron-api-mock'
import { DEFAULT_SETTINGS } from '../../platform/settings'
import { pickRecording, pruneRecent, RECENT_LIMIT, rememberOpened, useRecentRecordings } from './last-opened'

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

test('recordings that are gone leave the list; none gone, it is the same list', () => {
  const kept = [3, 1]
  expect(pruneRecent([3, 9, 1, 8], list(1, 2, 3))).toEqual([3, 1])
  expect(pruneRecent(kept, list(1, 2, 3))).toBe(kept)
})

describe('useRecentRecordings', () => {
  afterEach(() => vi.unstubAllGlobals())

  function setup(saved: number[]) {
    let release = () => {}
    const file = { ...DEFAULT_SETTINGS, recentTranscriptIds: saved }
    const firstRead = new Promise<void>(resolve => { release = resolve })
    const bridge = createMockElectronAPI({
      // The file is read only when the test says so.
      readSettings: () => firstRead.then(() => structuredClone(file)),
      writeSettings: async data => { Object.assign(file, data) },
    })
    vi.stubGlobal('electronAPI', bridge)
    const { result } = renderHook(() => useRecentRecordings())
    return { result, file, release: () => act(async () => release()) }
  }

  test('one opened before the settings are read goes on top of those saved', async () => {
    const { result, file, release } = setup([2, 1])
    act(() => result.current.remember(5))
    await release()
    await waitFor(() => expect(file.recentTranscriptIds).toEqual([5, 2, 1]))
    expect(result.current.ids).toEqual([5, 2, 1])
  })

  test('recordings deleted since are forgotten once the list is known', async () => {
    const { result, file, release } = setup([3, 9, 1])
    await release()
    act(() => result.current.prune(list(1, 2, 3)))
    await waitFor(() => expect(file.recentTranscriptIds).toEqual([3, 1]))
  })
})
