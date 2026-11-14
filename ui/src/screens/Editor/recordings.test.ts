import { describe, expect, test } from 'vitest'
import { TRANSCRIPTS, SPEAKERS, SPEAKER_IDS, FIXTURE_NOW, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import type { Speaker, TranscriptListItem } from '../../api/types'
import { deleteRecordingPrompt, goneFromList, groupRecordings, leftList, stackSpeakers } from './recordings'

const item = (id: number, created_at: string, speakers: string[] = []): TranscriptListItem => ({
  id, created_at, speakers, title: `Recording ${id}`, status: 'done', opened: true, section: '', duration: '',
})
const titles = (sections: ReturnType<typeof groupRecordings>) =>
  sections.map(section => [section.title, section.items.map(i => i.id)])

const NOW = new Date(2026, 9, 5, 12)

test('this week reaches back seven days and includes both ends', () => {
  const items = [
    item(1, '2026-10-05T23:59:00'),
    item(2, '2026-09-28T00:01:00'),
    item(3, '2026-09-27T23:59:00'),
  ]
  expect(titles(groupRecordings(items, NOW))).toEqual([['This week', [1, 2]], ['Earlier', [3]]])
})

test('the boundary is a calendar date, not 168 hours from now', () => {
  const lateEvening = new Date(2026, 9, 5, 23, 30)
  expect(titles(groupRecordings([item(1, '2026-09-28T00:01:00')], lateEvening))).toEqual([['This week', [1]]])
})

test('a recording without a date counts as today, as on the backend', () => {
  expect(titles(groupRecordings([item(1, '')], NOW))).toEqual([['This week', [1]]])
})

test('empty sections are left out', () => {
  expect(groupRecordings([], NOW)).toEqual([])
  expect(titles(groupRecordings([item(1, '2026-01-01T10:00:00')], NOW))).toEqual([['Earlier', [1]]])
})

test('pinned recordings come first, in the order given, and leave their sections', () => {
  const items = [item(1, '2026-10-05T10:00:00'), item(2, '2026-10-04T10:00:00'), item(3, '2026-01-01T10:00:00')]
  expect(titles(groupRecordings(items, NOW, [3, 1]))).toEqual([['Pinned', [3, 1]], ['This week', [2]]])
})

test('a pinned id that is not in the list is ignored', () => {
  expect(titles(groupRecordings([item(1, '2026-10-05T10:00:00')], NOW, [99]))).toEqual([['This week', [1]]])
})

test('the fixtures reproduce the board', () => {
  const sections = groupRecordings(TRANSCRIPTS, FIXTURE_NOW, [WEEKLY_SYNC_ID, 2])
  expect(sections.map(s => [s.title, s.items.length])).toEqual([['Pinned', 2], ['This week', 3], ['Earlier', 11]])
})

const speaker = (id: string, name: string | null, color_index = 0) =>
  ({ id, name, color_index }) as Speaker

test('a named speaker gets the name and the colour', () => {
  expect(stackSpeakers(['a'], [speaker('a', 'Anna', 4)])).toEqual([{ id: 'a', name: 'Anna', color: 5, title: 'Anna' }])
})

test('a speaker with no name, or not in the list, is unknown', () => {
  expect(stackSpeakers(['a', 'b'], [speaker('a', null)])).toEqual([{ id: 'a', kind: 'unknown' }, { id: 'b', kind: 'unknown' }])
})

test('an empty name is no name', () => {
  expect(stackSpeakers(['a'], [speaker('a', '')])).toEqual([{ id: 'a', kind: 'unknown' }])
})

test('on the fixtures the colours follow the boards', () => {
  const [anna, mark, unknown] = stackSpeakers([SPEAKER_IDS.anna, SPEAKER_IDS.mark, SPEAKER_IDS.unknown1], SPEAKERS)
  expect(anna).toMatchObject({ name: 'Anna Petrova', color: 5 })
  expect(mark).toMatchObject({ name: 'Mark Ellis', color: 1 })
  expect(unknown).toMatchObject({ kind: 'unknown' })
})

test('delete prompt: names the recording and says it cannot be undone', () => {
  const prompt = deleteRecordingPrompt('Weekly sync')
  expect(prompt.title).toBe('Delete "Weekly sync"?')
  expect(prompt.body).not.toMatch(/cannot be undone/i)
  expect(prompt.warning).toBe('This cannot be undone.')
})

test('delete prompt: falls back for an empty title', () => {
  expect(deleteRecordingPrompt('').title).toBe('Delete this transcript?')
})

describe('goneFromList', () => {
  test('a recording that was on the list and is not any more is gone', () => {
    expect(goneFromList(5, [4, 5, 6], [4, 6])).toBe(true)
    expect(goneFromList(5, [5], [])).toBe(true)
  })

  test('a recording still on the list, or never on it yet, is not', () => {
    expect(goneFromList(5, [4, 5], [4, 5])).toBe(false)
    // Opened from the toast of a finished job before the list has it.
    expect(goneFromList(7, [4, 5], [4, 5])).toBe(false)
    expect(goneFromList(5, null, [4])).toBe(false)
    expect(goneFromList(null, [4, 5], [4])).toBe(false)
  })
})

describe('leftList', () => {
  test('the recordings on the list before and not now', () => {
    expect(leftList([4, 5, 6], [4, 6, 7])).toEqual([5])
    expect(leftList([4, 5], [4, 5])).toEqual([])
  })

  test('none before the list first loads', () => {
    expect(leftList(null, [4])).toEqual([])
  })
})
