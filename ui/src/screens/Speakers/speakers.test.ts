import { describe, expect, test } from 'vitest'
import {
  categoryCounts, deleteBlockReason, deleteSpeakerPrompt, draftChanges, draftDirty, duplicateNameIds, filterSpeakers, formatLastSeen,
  speakerAfter, speakerDisplayName, speakerDraft, speakerUsage,
} from './speakers'

const ROWS = [
  { id: 'a', name: 'Alice Smith', handle: 'alice.smith' },
  { id: 'b', name: 'Bob', handle: 'bobby' },
  { id: 'u', name: null, handle: null },
]
const ids = (rows: { id: string }[]) => rows.map(row => row.id)

describe('filterSpeakers', () => {
  test('all, named and unnamed', () => {
    expect(ids(filterSpeakers(ROWS, '', 'all'))).toEqual(['a', 'b', 'u'])
    expect(ids(filterSpeakers(ROWS, '', 'named'))).toEqual(['a', 'b'])
    expect(ids(filterSpeakers(ROWS, '', 'unnamed'))).toEqual(['u'])
  })

  test('a search matches any part of the name, whatever the case', () => {
    expect(ids(filterSpeakers(ROWS, '  SMI ', 'all'))).toEqual(['a'])
    expect(ids(filterSpeakers(ROWS, 'zzz', 'all'))).toEqual([])
  })

  test('a speaker without a name never matches a search', () => {
    expect(ids(filterSpeakers(ROWS, 'unnamed', 'unnamed'))).toEqual([])
  })

  test('a search matches the handle too, with or without the @', () => {
    expect(ids(filterSpeakers(ROWS, 'bobby', 'all'))).toEqual(['b'])
    expect(ids(filterSpeakers(ROWS, ' @BOBBY ', 'all'))).toEqual(['b'])
    expect(ids(filterSpeakers(ROWS, '@', 'all'))).toEqual(['a', 'b'])
  })
})

test('categoryCounts', () => {
  expect(categoryCounts(ROWS)).toEqual({ all: 3, named: 2, unnamed: 1 })
  expect(categoryCounts([])).toEqual({ all: 0, named: 0, unnamed: 0 })
})

test('duplicateNameIds: names that differ only by case or spaces', () => {
  const rows = [...ROWS, { id: 'a2', name: ' alice  smith' }]
  expect([...duplicateNameIds(rows)].sort()).toEqual(['a', 'a2'])
  expect(duplicateNameIds(ROWS).size).toBe(0)
})

test('speakerDisplayName', () => {
  expect(speakerDisplayName(ROWS[0])).toBe('Alice Smith')
  expect(speakerDisplayName(ROWS[2])).toBe('Unnamed speaker')
})

test('speakerUsage: recordings and time as separate values', () => {
  expect(speakerUsage({ transcripts: 1, duration_sec: 75 })).toEqual({ recordings: '1 recording', time: 75 })
  expect(speakerUsage({ transcripts: 3, duration_sec: 0 })).toEqual({ recordings: '3 recordings', time: 0 })
  expect(speakerUsage({ transcripts: 0, duration_sec: 0 })).toEqual({ recordings: 'Not in any recording', time: null })
})

describe('deleteSpeakerPrompt', () => {
  test('names the speaker and the segments that become Unassigned', () => {
    const prompt = deleteSpeakerPrompt({ name: 'Bob', segments: 12, transcripts: 3 })
    expect(prompt.title).toBe('Delete "Bob"?')
    expect(prompt.body).toMatch(/12 segments in 3 recordings will become Unassigned/)
    expect(prompt.body).toMatch(/cannot be undone/i)
  })

  test('a speaker without a name or segments', () => {
    const prompt = deleteSpeakerPrompt({ name: null, segments: 0, transcripts: 0 })
    expect(prompt.title).toBe('Delete this speaker?')
    expect(prompt.body).not.toMatch(/Unassigned/)
  })

  test('singular forms', () => {
    expect(deleteSpeakerPrompt({ name: 'Bob', segments: 1, transcripts: 1 }).body).toMatch(/1 segment in 1 recording will become Unassigned/)
  })
})

test('deleteBlockReason: a running transcription or a recording', () => {
  expect(deleteBlockReason(undefined)).toBeNull()
  expect(deleteBlockReason({ running_job_id: null, recording: false })).toBeNull()
  expect(deleteBlockReason({ running_job_id: 'job', recording: false })).toMatch(/queue/)
  expect(deleteBlockReason({ running_job_id: null, recording: true })).toMatch(/recording/)
})

test('speakerAfter: the next one, else the one before', () => {
  expect(speakerAfter(['a', 'b', 'c'], 'b')).toBe('c')
  expect(speakerAfter(['a', 'b', 'c'], 'c')).toBe('b')
  expect(speakerAfter(['a'], 'a')).toBeNull()
  expect(speakerAfter(['a'], 'x')).toBeNull()
})

test('formatLastSeen', () => {
  expect(formatLastSeen('2026-10-04T02:33:00')).toBe('4 Oct 2026')
  expect(formatLastSeen('')).toBe('Never')
})

describe('speaker drafts', () => {
  const lena = { id: 'lena', name: 'Lena Kovacs', color_index: 3, handle: 'lena.kovacs', handle_manual: false }

  test('a fresh draft is the speaker as saved, with nothing to save', () => {
    const draft = speakerDraft(lena)
    expect(draft).toEqual({ id: 'lena', name: 'Lena Kovacs', colorIndex: 3, handle: null })
    expect(draftChanges(draft, lena)).toBeNull()
  })

  test('a speaker without a name starts with an empty one', () => {
    expect(speakerDraft({ id: 'x', name: null, color_index: 0, handle: null, handle_manual: false }).name).toBe('')
  })

  test('the changes are what differs, the name trimmed', () => {
    expect(draftChanges({ ...speakerDraft(lena), name: '  Lena K  ' }, lena)).toEqual({ name: 'Lena K' })
    expect(draftChanges({ ...speakerDraft(lena), colorIndex: 0 }, lena)).toEqual({ color_index: 0 })
    expect(draftChanges({ ...speakerDraft(lena), name: 'Lena K', colorIndex: 0 }, lena)).toEqual({ name: 'Lena K', color_index: 0 })
    expect(draftChanges({ ...speakerDraft(lena), name: ' Lena Kovacs ' }, lena)).toBeNull()
  })

  test('a blank name is a change that cannot be saved', () => {
    const draft = { ...speakerDraft(lena), name: '   ' }
    expect(draftDirty(draft, lena)).toBe(true)
    expect(draftChanges(draft, lena)).toBeNull()
  })

  test('a speaker who had no name and still has none has nothing to save', () => {
    const unnamed = { id: 'x', name: null, color_index: 0, handle: null, handle_manual: false }
    expect(draftDirty(speakerDraft(unnamed), unnamed)).toBe(false)
    expect(draftDirty({ ...speakerDraft(unnamed), name: ' ' }, unnamed)).toBe(false)
  })

  test('a handle typed is sent as kept, and only when it differs', () => {
    expect(draftChanges({ ...speakerDraft(lena), handle: ' @Lena.K ' }, lena)).toEqual({ handle: 'lena.k' })
    expect(draftDirty({ ...speakerDraft(lena), handle: 'lena.k' }, lena)).toBe(true)
    expect(draftChanges({ ...speakerDraft(lena), handle: 'Lena.Kovacs' }, lena)).toBeNull()
    expect(draftDirty({ ...speakerDraft(lena), handle: 'lena.kovacs' }, lena)).toBe(false)
    expect(draftChanges({ ...speakerDraft(lena), name: 'Lena K', handle: 'lk' }, lena)).toEqual({ name: 'Lena K', handle: 'lk' })
  })

  test('an emptied handle goes back to the one made from the name, if it was set by hand', () => {
    const manual = { ...lena, handle: 'lk', handle_manual: true }
    expect(draftChanges({ ...speakerDraft(manual), handle: '  ' }, manual)).toEqual({ handle: '' })
    expect(draftDirty({ ...speakerDraft(manual), handle: '' }, manual)).toBe(true)
    // Already made from the name: nothing to do.
    expect(draftChanges({ ...speakerDraft(lena), handle: '' }, lena)).toBeNull()
    expect(draftDirty({ ...speakerDraft(lena), handle: '' }, lena)).toBe(false)
  })
})
