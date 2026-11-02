import { describe, expect, test } from 'vitest'
import { SPEAKERS, SPEAKER_IDS, weeklySync } from '../../api/fixtures/data'
import { UNASSIGNED, type Segment } from '../../api/types'
import { firstSegmentOf, pendingReview, speakerRows, splitRows, talkTotal } from './inspector'

const { anna, mark, oliver, sofia, lena, unknown1 } = SPEAKER_IDS
const SEGMENTS = weeklySync().segments

describe('speakerRows', () => {
  test('the longest first, with the talk time of the board', () => {
    const rows = speakerRows(SEGMENTS, SPEAKERS)
    expect(rows.map(row => row.id)).toEqual([anna, mark, unknown1, oliver, lena, sofia])
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

  test('three rows, the rest behind Show more', () => {
    const { visible, hidden } = splitRows(rows, null)
    expect(visible.map(row => row.id)).toEqual([anna, mark, unknown1])
    expect(hidden.map(row => row.id)).toEqual([oliver, lena, sofia])
  })

  test('the current speaker stays in sight, in place of the third', () => {
    const { visible, hidden } = splitRows(rows, oliver)
    expect(visible.map(row => row.id)).toEqual([anna, mark, oliver])
    expect(hidden.map(row => row.id)).toEqual([unknown1, lena, sofia])
  })

  test('few rows hide nothing', () => {
    expect(splitRows(rows.slice(0, 3), null).hidden).toEqual([])
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
