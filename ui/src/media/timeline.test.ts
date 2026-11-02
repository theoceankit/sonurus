import { expect, test } from 'vitest'
import {
  activeSegmentIndex, barTurns, formatClock, formatDuration, nextSpeakerTime, playerClock, previousSpeakerTime, skipTime, timelineDuration, turnAt,
  type Turn,
} from './timeline'

const turn = (start: number, end: number, speaker: string): Turn => ({ start, end, speaker, name: speaker, color: 1 })

test('playerClock: time, duration and play state come from the audio element', () => {
  expect(playerClock({ currentTime: 65.4, duration: 305.2, paused: true })).toEqual({ elapsed: '01:05', total: '05:05', playing: false })
  expect(playerClock({ currentTime: 3, duration: 10, paused: false }).playing).toBe(true)
})

test('playerClock: duration not known yet shows 00:00', () => {
  expect(playerClock({ currentTime: 0, duration: NaN, paused: true }).total).toBe('00:00')
  expect(playerClock({ currentTime: 0, duration: Infinity, paused: true }).total).toBe('00:00')
})

test('formatClock: minutes and seconds, hours from one hour on', () => {
  expect(formatClock(35)).toBe('00:35')
  expect(formatClock(3599.9)).toBe('59:59')
  expect(formatClock(3600)).toBe('1:00:00')
  expect(formatClock(3725)).toBe('1:02:05')
  expect(formatClock(36000)).toBe('10:00:00')
})

const SEGS = [{ start: 0, end: 4 }, { start: 5, end: 9 }, { start: 9, end: 12 }]

test('activeSegmentIndex: the segment that contains the time', () => {
  expect(activeSegmentIndex(SEGS, 2)).toBe(0)
  expect(activeSegmentIndex(SEGS, 5)).toBe(1)   // start is inside
  expect(activeSegmentIndex(SEGS, 9)).toBe(2)   // end is not: the next segment starts there
  expect(activeSegmentIndex(SEGS, 11.9)).toBe(2)
})

test('activeSegmentIndex: -1 between, before and after segments', () => {
  expect(activeSegmentIndex(SEGS, 4.5)).toBe(-1)
  expect(activeSegmentIndex(SEGS, -1)).toBe(-1)
  expect(activeSegmentIndex(SEGS, 12)).toBe(-1)
  expect(activeSegmentIndex([], 1)).toBe(-1)
})

test('formatDuration: minutes without a leading zero, from an hour on with hours', () => {
  expect(formatDuration(4)).toBe('0:04')
  expect(formatDuration(19.6)).toBe('0:20')
  expect(formatDuration(3725)).toBe('1:02:05')
  expect(formatDuration(NaN)).toBe('0:00')
})

const TURNS = [turn(0, 5, 'anna'), turn(5, 8, 'mark'), turn(8, 10, 'mark'), turn(12, 16, 'anna'), turn(16, 25, 'lena')]

test('turnAt: the first turn that contains the time, none in a pause', () => {
  expect(turnAt(TURNS, 5)?.speaker).toBe('mark')
  expect(turnAt(TURNS, 11)).toBeNull()
  expect(turnAt([turn(44, 47, 'sofia'), turn(45, 53, 'anna')], 46)?.speaker).toBe('sofia')
})

test('next speaker: the start of the next block of one speaker', () => {
  expect(nextSpeakerTime(TURNS, 1)).toBe(5)
  expect(nextSpeakerTime(TURNS, 6)).toBe(12)    // the second turn of mark is the same block
  expect(nextSpeakerTime(TURNS, 11)).toBe(12)   // a pause belongs to the block before it
})

test('next speaker: nothing after the last block', () => {
  expect(nextSpeakerTime(TURNS, 20)).toBeNull()
  expect(nextSpeakerTime([], 0)).toBeNull()
})

test('previous speaker: the start of the block before the current one', () => {
  expect(previousSpeakerTime(TURNS, 9)).toBe(0)
  expect(previousSpeakerTime(TURNS, 20)).toBe(12)
})

test('previous speaker: nothing in the first block', () => {
  expect(previousSpeakerTime(TURNS, 3)).toBeNull()
  expect(previousSpeakerTime([], 0)).toBeNull()
})

test('skipTime stays inside the recording', () => {
  expect(skipTime(20, -15, 53)).toBe(5)
  expect(skipTime(5, -15, 53)).toBe(0)
  expect(skipTime(20, 15, 53)).toBe(35)
  expect(skipTime(50, 15, 53)).toBe(53)
})

test('timelineDuration: the audio, or the end of the last segment until it is known', () => {
  expect(timelineDuration(53, TURNS)).toBe(53)
  expect(timelineDuration(NaN, TURNS)).toBe(25)
  expect(timelineDuration(Infinity, [turn(0, 9, 'a'), turn(3, 5, 'b')])).toBe(9)
  expect(timelineDuration(NaN, [])).toBe(0)
})

test('barTurns: each bar takes the turn at its middle', () => {
  const bars = barTurns([turn(0, 5, 'anna'), turn(7.5, 10, 'mark')], 4, 10)
  expect(bars.map(bar => bar?.speaker ?? null)).toEqual(['anna', 'anna', null, 'mark'])
})

test('barTurns: no duration means silence', () => {
  expect(barTurns(TURNS, 3, 0)).toEqual([null, null, null])
})
