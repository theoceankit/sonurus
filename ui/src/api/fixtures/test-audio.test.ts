import { expect, test } from 'vitest'
import type { Segment } from '../types'
import { createFixtureClient } from './fixture-client'
import { weeklySync } from './data'
import { encodeWav, synthesize } from './test-audio'

const RATE = 8000

const segment = (start: number, end: number, speaker: string) => ({
  start, end, text: '', speaker_raw: speaker, speaker_resolved: speaker, speaker_final: null, unassigned: false,
}) as unknown as Segment

const crossings = (samples: Int16Array) => samples.reduce((count, sample, i) => count + (i && sample >= 0 !== samples[i - 1] >= 0 ? 1 : 0), 0)
const slice = (samples: Int16Array, from: number, to: number) => samples.subarray(from * RATE, to * RATE)

test('lasts until the end of the last segment', () => {
  expect(synthesize([segment(0, 1, 'a'), segment(1, 2.5, 'b')])).toHaveLength(2.5 * RATE)
})

test('a pause is silence', () => {
  const samples = synthesize([segment(0, 1, 'a'), segment(2, 3, 'a')])
  expect(slice(samples, 1, 2).every(sample => sample === 0)).toBe(true)
  expect(slice(samples, 0, 1).some(sample => sample !== 0)).toBe(true)
})

test('speakers have different tones, the same speaker the same one', () => {
  const samples = synthesize([segment(0, 1, 'a'), segment(1, 2, 'b'), segment(2, 3, 'a')])
  expect(crossings(slice(samples, 1, 2))).toBeGreaterThan(crossings(slice(samples, 0, 1)))
  expect(Math.abs(crossings(slice(samples, 2, 3)) - crossings(slice(samples, 0, 1)))).toBeLessThanOrEqual(2)
})

test('the earlier of two overlapping segments wins', () => {
  const samples = synthesize([segment(0, 2, 'a'), segment(1, 3, 'b')])
  const alone = synthesize([segment(0, 2, 'a')])
  expect(crossings(slice(samples, 1, 2))).toBe(crossings(slice(alone, 1, 2)))
})

test('stays quiet', () => {
  const samples = synthesize([segment(0, 1, 'a')])
  expect(Math.max(...slice(samples, 0, 1))).toBeLessThan(0.25 * 0x7fff)
})

test('the file is a WAV of what was given', () => {
  const buffer = encodeWav(new Int16Array([1, -2]))
  const view = new DataView(buffer)
  const text = (from: number, to: number) => String.fromCharCode(...new Uint8Array(buffer.slice(from, to)))
  expect(text(0, 4)).toBe('RIFF')
  expect(text(8, 12)).toBe('WAVE')
  expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8)
  expect(view.getUint32(24, true)).toBe(RATE)
  expect(view.getUint32(40, true)).toBe(4)
  expect(view.getInt16(44, true)).toBe(1)
  expect(view.getInt16(46, true)).toBe(-2)
})

test('the fixture client makes one URL per recording, or none without audio', () => {
  const client = createFixtureClient()
  const transcript = weeklySync()
  const url = client.getAudioUrl(transcript)
  expect(url).toMatch(/^blob:/)
  expect(client.getAudioUrl(transcript)).toBe(url)
  expect(createFixtureClient({ noAudio: true }).getAudioUrl(transcript)).toBeNull()
})
