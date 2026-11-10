import { describe, expect, test } from 'vitest'
import { UNASSIGNED, type Segment, type Speaker, type Transcript } from '../../api/types'
import {
  buildTurns, formatRecordingDate, languageLabel, recordingTitle, speakerMenuRows, talkTimes, titleToSave, transcriptText, unknownSpeakerNames,
} from './transcript'

const segment = (start: number, end: number, speaker: string | null, changes: Partial<Segment> = {}) => ({
  start, end, text: `at ${start}`, speaker_raw: 'SPEAKER_00', speaker_resolved: speaker, speaker_final: null, unassigned: false, ...changes,
}) as Segment
const speaker = (id: string, name: string | null, color_index = 0, changes: Partial<Speaker> = {}) => ({
  id, name, color_index, segments: 1, transcripts: 1, duration_sec: 60, ...changes,
}) as Speaker

const SPEAKERS = [speaker('anna', 'Anna', 4), speaker('mark', 'Mark', 0), speaker('nameless', null, 2)]

describe('buildTurns', () => {
  test('neighbouring segments of one speaker make one turn, whatever the pause', () => {
    const turns = buildTurns([segment(0, 1, 'anna'), segment(100, 101, 'anna'), segment(101, 102, 'mark'), segment(102, 103, 'anna')], SPEAKERS)
    expect(turns.map(turn => [turn.speaker.id, turn.start, turn.segments.length])).toEqual([['anna', 0, 2], ['mark', 101, 1], ['anna', 102, 1]])
  })

  test('the turn keeps the segments it got, so unchanged ones stay the same objects', () => {
    const first = segment(0, 1, 'anna')
    expect(buildTurns([first], SPEAKERS)[0].segments[0]).toBe(first)
  })

  test('a named speaker has its name and colour', () => {
    expect(buildTurns([segment(0, 1, 'anna')], SPEAKERS)[0].speaker).toEqual({ id: 'anna', kind: 'named', name: 'Anna', color: 5 })
  })

  test('a speaker with no name or not known is an unknown one, numbered by first appearance', () => {
    const turns = buildTurns([segment(0, 1, 'gone'), segment(1, 2, 'anna'), segment(2, 3, 'nameless'), segment(3, 4, 'gone')], SPEAKERS)
    expect(turns.map(turn => [turn.speaker.kind, turn.speaker.name, turn.speaker.color])).toEqual([
      ['unknown', 'Unknown speaker 1', 6], ['named', 'Anna', 5], ['unknown', 'Unknown speaker 2', 6], ['unknown', 'Unknown speaker 1', 6],
    ])
  })

  test('unassigned segments make their own kind, and take no number', () => {
    const turns = buildTurns([segment(0, 1, 'anna', { unassigned: true }), segment(1, 2, 'gone')], SPEAKERS)
    expect(turns[0].speaker).toEqual({ id: UNASSIGNED, kind: 'unassigned', name: 'Unassigned', color: 6 })
    expect(turns[1].speaker.name).toBe('Unknown speaker 1')
  })

  test('a correction wins, as everywhere', () => {
    expect(buildTurns([segment(0, 1, 'anna', { speaker_final: 'mark' })], SPEAKERS)[0].speaker.id).toBe('mark')
  })

  test('segments that overlap stay in their order', () => {
    const turns = buildTurns([segment(44, 47, 'mark'), segment(45, 53, 'anna')], SPEAKERS)
    expect(turns.map(turn => turn.start)).toEqual([44, 45])
  })

  test('no segments, no turns', () => {
    expect(buildTurns([], SPEAKERS)).toEqual([])
  })
})

test('unknownSpeakerNames: only speakers with no name get a number', () => {
  expect(unknownSpeakerNames([segment(0, 1, 'anna'), segment(1, 2, 'x'), segment(2, 3, 'y'), segment(3, 4, 'x')], SPEAKERS)).toEqual(
    new Map([['x', 'Unknown speaker 1'], ['y', 'Unknown speaker 2']]),
  )
})

test('talkTimes: adds up the segments of each speaker', () => {
  const times = talkTimes([segment(0, 5, 'anna'), segment(5, 8, 'mark'), segment(8, 10, 'anna'), segment(10, 11, 'anna', { unassigned: true })])
  expect(times).toEqual(new Map([['anna', 7], ['mark', 3], [UNASSIGNED, 1]]))
})

describe('speakerMenuRows', () => {
  const known = [speaker('anna', 'Anna'), speaker('mark', 'Mark'), speaker('lena', 'Lena'), speaker('nameless', null)]
  const times = new Map([['anna', 3], ['mark', 20], ['nameless', 5], [UNASSIGNED, 1]])

  test('without a search: named speakers of the recording, the longest first', () => {
    const { section, rows } = speakerMenuRows(known, times, 'anna', '')
    expect(section).toBe('In this recording')
    expect(rows.map(row => [row.speaker.id, row.time, row.current])).toEqual([['mark', '0:20', false], ['anna', '0:03', true]])
  })

  test('a search goes over all named speakers, ignoring case and spaces', () => {
    const { section, rows } = speakerMenuRows(known, times, 'anna', ' LE ')
    expect(section).toBeNull()
    expect(rows.map(row => [row.speaker.id, row.time])).toEqual([['lena', undefined]])
  })

  test('a speaker with no name is never offered', () => {
    expect(speakerMenuRows(known, times, null, 'a').rows.map(row => row.speaker.id)).toEqual(['anna', 'mark', 'lena'])
  })

  test('speakers with one name are told apart by their usage', () => {
    const same = [speaker('a', 'Anna', 0, { transcripts: 3, duration_sec: 3725 }), speaker('b', 'Anna', 0, { transcripts: 1, duration_sec: 40 }), speaker('c', 'Mark')]
    const { rows } = speakerMenuRows(same, new Map(), null, 'a')
    expect(rows.map(row => row.usage)).toEqual(['3 transcripts, 1:02:05', '1 transcript, 0:40', undefined])
  })
})

describe('titleToSave', () => {
  test('trims a changed title', () => expect(titleToSave('  Weekly sync ', 'Old')).toBe('Weekly sync'))
  test('empty or blank: nothing to save', () => {
    expect(titleToSave('', 'Old')).toBeNull()
    expect(titleToSave('   ', 'Old')).toBeNull()
  })
  test('unchanged after a trim: nothing to save', () => expect(titleToSave(' Old ', 'Old')).toBeNull())
  test('longer than 200 characters: nothing to save', () => {
    expect(titleToSave('x'.repeat(201), 'Old')).toBeNull()
    expect(titleToSave('x'.repeat(200), 'Old')).toBe('x'.repeat(200))
  })
})

describe('languageLabel', () => {
  test('a known code gives its name from the language list', () => {
    expect(languageLabel('ru')).toBe('Русский')
    expect(languageLabel('en')).toBe('English')
  })
  test('a code outside the list gives the code', () => expect(languageLabel('xx')).toBe('xx'))
  test('unknown, auto or missing give no label', () => {
    for (const language of ['unknown', 'Unknown', 'auto', '', null, undefined]) expect(languageLabel(language)).toBe('')
  })
})

test('recordingTitle: the title, then the name in the list, then the file without its extension', () => {
  const transcript = (title: string | null) => ({ title, audio_path: '/data/recordings/team_weekly-sync.wav' }) as Transcript
  expect(recordingTitle(transcript('Sync'), 'Listed')).toBe('Sync')
  expect(recordingTitle(transcript(null), 'Listed')).toBe('Listed')
  expect(recordingTitle(transcript(''), undefined)).toBe('team weekly sync')
  expect(recordingTitle({ title: null, audio_path: 'C:\\rec\\call.mp3' } as Transcript, undefined)).toBe('call')
})

test('formatRecordingDate: as on the boards, nothing for a bad date', () => {
  expect(formatRecordingDate('2026-10-04T02:33:00')).toBe('4 Oct 2026, 02:33')
  expect(formatRecordingDate('not a date')).toBe('')
  expect(formatRecordingDate(undefined)).toBe('')
})

describe('transcriptText', () => {
  test('each turn is its speaker and start time, then a line per paragraph; turns apart by an empty line', () => {
    const turns = buildTurns([
      segment(12, 14, 'mark', { text: 'So the budget.' }),
      segment(14, 16, 'mark', { text: 'Three items today.' }),
      segment(3725, 3730, 'gone', { text: 'Sure, go ahead.' }),
      segment(3730, 3731, 'anna', { text: 'Late.', unassigned: true }),
    ], SPEAKERS)
    expect(transcriptText(turns)).toBe(
      'Mark 00:12\nSo the budget.\nThree items today.\n\nUnknown speaker 1 1:02:05\nSure, go ahead.\n\nUnassigned 1:02:10\nLate.',
    )
  })

  test('the user\'s correction of the speaker and the edited text are what is copied', () => {
    const turns = buildTurns([segment(0, 1, 'anna', { speaker_final: 'mark', text: 'Edited.' })], SPEAKERS)
    expect(transcriptText(turns)).toBe('Mark 00:00\nEdited.')
  })

  test('no turns, no text', () => {
    expect(transcriptText([])).toBe('')
  })
})
