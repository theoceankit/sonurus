import { describe, expect, test } from 'vitest'
import { SPEAKERS, SPEAKER_IDS, weeklySync } from '../../api/fixtures/data'
import { UNASSIGNED, type Segment } from '../../api/types'
import { firstSegmentOf, pendingReview, rowSlots, speakerRows, splitRows, talkTotal } from './inspector'

const { anna, mark, oliver, sofia, lena, unknown1 } = SPEAKER_IDS
const SEGMENTS = weeklySync().segments

describe('speakerRows', () => {
  test('the longest first, with the talk time of the board', () => {
    const rows = speakerRows(SEGMENTS, SPEAKERS)
    expect(rows.map(row => row.id)).toEqual([anna, mark, unknown1, oliver, sofia, lena])
    expect(rows.map(row => row.time)).toEqual(['0:19', '0:11', '0:09', '0:07', '0:04', '0:03'])
  })

  test('says how to show each speaker', () => {
    const rows = speakerRows(SEGMENTS, SPEAKERS)
    expect(rows[0]).toMatchObject({ kind: 'named', name: 'Anna Petrova', color: 5 })
    expect(rows[2]).toMatchObject({ kind: 'unknown', name: 'Unknown speaker 1', color: 6 })
  })

  test('unassigned goes last, however long', () => {
    const segments: Segment[] = SEGMENTS.map(s => (s.speaker_resolved === unknown1 ? { ...s, speaker_resolved: null, unassigned: true, end: s.end + 100 } : s))
    const rows = speakerRows(segments, SPEAKERS)
    expect(rows.at(-1)).toMatchObject({ id: UNASSIGNED, kind: 'unassigned', name: 'Unassigned', color: 6 })
  })

  test('no segments, no rows', () => {
    expect(speakerRows([], SPEAKERS)).toEqual([])
  })
})

test('talkTotal is the sum of the segments', () => {
  expect(talkTotal(speakerRows(SEGMENTS, SPEAKERS))).toBe(53)
})

describe('splitRows', () => {
  const rows = speakerRows(SEGMENTS, SPEAKERS)

  test('as many rows as fit, the last place for Show more', () => {
    const { visible, hidden } = splitRows(rows, null, 4)
    expect(visible.map(row => row.id)).toEqual([anna, mark, unknown1])
    expect(hidden.map(row => row.id)).toEqual([oliver, sofia, lena])
  })

  test('everyone, when everyone fits', () => {
    expect(splitRows(rows, null, 6).hidden).toEqual([])
    expect(splitRows(rows, null, 20).visible).toHaveLength(6)
  })

  test('everyone, before the room is known', () => {
    expect(splitRows(rows, null, null).hidden).toEqual([])
  })

  test('one speaker at least, however little room', () => {
    expect(splitRows(rows, null, 1).visible.map(row => row.id)).toEqual([anna])
    expect(splitRows(rows, null, 0).visible.map(row => row.id)).toEqual([anna])
  })

  test('the current speaker stays in sight, in the last place', () => {
    const { visible, hidden } = splitRows(rows, oliver, 4)
    expect(visible.map(row => row.id)).toEqual([anna, mark, oliver])
    expect(hidden.map(row => row.id)).toEqual([unknown1, sofia, lena])
    expect(splitRows(rows, lena, 1).visible.map(row => row.id)).toEqual([lena])
  })

  test('eight rows at most, however much room', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...rows[0], id: `speaker-${i}` }))
    expect(splitRows(many, null, 20).visible).toHaveLength(8)
    expect(splitRows(many, null, null).visible).toHaveLength(8)
    expect(splitRows(many.slice(0, 8), null, 20).hidden).toEqual([])
    expect(splitRows(many, 'speaker-8', 20).visible.at(-1)!.id).toBe('speaker-8')
  })

  test('the current speaker in sight keeps their place', () => {
    expect(splitRows(rows, mark, 4).visible.map(row => row.id)).toEqual([anna, mark, unknown1])
  })
})

describe('rowSlots', () => {
  // Rows of 28 px, 2 px apart.
  test('how many rows a height holds', () => {
    expect(rowSlots(0)).toBe(0)
    expect(rowSlots(27)).toBe(0)
    expect(rowSlots(28)).toBe(1)
    expect(rowSlots(57)).toBe(1)
    expect(rowSlots(58)).toBe(2)
    expect(rowSlots(118)).toBe(4)
  })
})

describe('pendingReview', () => {
  test('speakers with no name, in the order they first speak', () => {
    const segments = [...SEGMENTS]
    expect(pendingReview(segments, SPEAKERS)).toEqual([unknown1])
  })

  test('unassigned is not reviewed', () => {
    const segments: Segment[] = SEGMENTS.map(s => (s.speaker_resolved === unknown1 ? { ...s, unassigned: true } : s))
    expect(pendingReview(segments, SPEAKERS)).toEqual([])
  })

  test('with possible matches: also the recognized ones that have candidates, in order of speaking', () => {
    expect(pendingReview(SEGMENTS, SPEAKERS, [oliver, sofia, lena])).toEqual([unknown1, lena, oliver, sofia])
  })
})

test('firstSegmentOf: what a row plays', () => {
  expect(firstSegmentOf(SEGMENTS, mark)).toMatchObject({ start: 5, end: 8 })
  expect(firstSegmentOf(SEGMENTS, 'nobody')).toBeUndefined()
})
