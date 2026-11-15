import { expect, test } from 'vitest'
import type { Segment, Speaker } from '../../api/types'
import { speakerRows } from './inspector'
import { stackSpeakers } from './recordings'
import { chooseSpeakerList } from './speaker-search'
import { buildTurns } from './transcript'

// Every place that draws a speaker's avatar gets the photo from the speaker list.
const PHOTO = 'http://localhost:8000/speakers/anna/photo?v=1.jpg'
const speaker = (id: string, name: string | null, photo_url: string | null = null) => ({
  id, name, color_index: 0, segments: 1, transcripts: 1, duration_sec: 60, photo: photo_url && '1.jpg', photo_url,
}) as Speaker
const SPEAKERS = [speaker('anna', 'Anna', PHOTO), speaker('mark', 'Mark'), speaker('nameless', null)]
const segment = (start: number, id: string) => ({
  start, end: start + 1, text: '', speaker_raw: 'SPEAKER_00', speaker_resolved: id, speaker_final: null, unassigned: false,
}) as Segment
const SEGMENTS = [segment(0, 'anna'), segment(1, 'mark'), segment(2, 'nameless')]

test('a turn of the transcript', () => {
  expect(buildTurns(SEGMENTS, SPEAKERS).map(turn => turn.speaker.photo)).toEqual([PHOTO, null, undefined])
})

test('a row of the inspector', () => {
  expect(Object.fromEntries(speakerRows(SEGMENTS, SPEAKERS).map(row => [row.id, row.photo]))).toEqual({ anna: PHOTO, mark: null, nameless: undefined })
})

test('a stack of a recording', () => {
  expect(stackSpeakers(['anna', 'mark'], SPEAKERS).map(found => found.photo)).toEqual([PHOTO, null])
})

test('a row of Choose a speaker', () => {
  const rows = chooseSpeakerList({ speakers: SPEAKERS, candidates: [], recordingSpeakers: [], query: '', category: 'all' }).sections.flatMap(section => section.rows)
  expect(rows.find(row => row.id === 'anna')?.photo).toBe(PHOTO)
})
