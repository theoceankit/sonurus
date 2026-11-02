import { expect, test } from 'vitest'
import { effectiveSpeaker, UNASSIGNED, type Segment } from './types'

const segment = (changes: Partial<Segment>) => ({
  start: 0, end: 1, text: '', speaker_raw: 'SPEAKER_00', speaker_resolved: null, speaker_final: null, unassigned: false, ...changes,
}) as Segment

test('an unassigned segment wins over every speaker field', () => {
  expect(effectiveSpeaker(segment({ unassigned: true, speaker_resolved: 'a', speaker_final: 'b' }))).toBe(UNASSIGNED)
})

test('the correction, then the result, then the raw label', () => {
  expect(effectiveSpeaker(segment({ speaker_resolved: 'a', speaker_final: 'b' }))).toBe('b')
  expect(effectiveSpeaker(segment({ speaker_resolved: 'a' }))).toBe('a')
  expect(effectiveSpeaker(segment({}))).toBe('SPEAKER_00')
})
