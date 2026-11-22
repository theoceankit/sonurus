import { describe, expect, test } from 'vitest'
import type { Segment, Speaker } from '../../api/types'
import { buildTurns, transcriptText } from './transcript'
import { exportContent, type ExportOptions, type ExportSource } from './transcript-export'

const segment = (start: number, text: string, change: Partial<Segment> = {}): Segment => ({
  start, end: start + 2, text, speaker_raw: 'SPEAKER_00', speaker_resolved: null, speaker_final: null, unassigned: false, ...change,
})
const speakers = [
  { id: 'anna', name: 'Anna', color_index: 0 },
  { id: 'mark', name: 'Mark', color_index: 1 },
] as Speaker[]
const segments = [
  segment(0, 'Hello.', { speaker_resolved: 'mark', speaker_final: 'anna' }),
  segment(2, 'Second line.', { speaker_resolved: 'anna' }),
  segment(65, 'Hi.', { speaker_resolved: 'mark' }),
  segment(70, 'Who is this?', { speaker_raw: 'SPEAKER_01' }),
  segment(75, 'Gone.', { speaker_final: 'anna', unassigned: true }),
]
const source: ExportSource = { title: 'Weekly sync', language: 'en', turns: buildTurns(segments, speakers) }
const all = { timestamps: true, speakers: true }
const exportContents = (from: ExportSource, options: ExportOptions) => ({
  txt: exportContent('txt', from, options),
  md: exportContent('md', from, options),
  json: exportContent('json', from, options),
})

describe('txt', () => {
  test('with everything on it reads as Copy transcript', () => {
    expect(exportContents(source, all).txt).toBe(`${transcriptText(source.title, source.turns)}\n`)
  })

  test('takes out the time, the speaker, or both', () => {
    const short = { ...source, turns: source.turns.slice(0, 2) }
    expect(exportContents(short, { timestamps: false, speakers: true }).txt).toBe('Weekly sync\n\nAnna\nHello.\nSecond line.\n\nMark\nHi.\n')
    expect(exportContents(short, { timestamps: true, speakers: false }).txt).toBe('Weekly sync\n\n00:00\nHello.\nSecond line.\n\n01:05\nHi.\n')
    expect(exportContents(short, { timestamps: false, speakers: false }).txt).toBe('Weekly sync\n\nHello.\nSecond line.\n\nHi.\n')
  })

  test('the note closes it', () => {
    expect(exportContents({ ...source, turns: [], note: '- [ ] Call back' }, all).txt).toBe('Weekly sync\n\nNotes\n\n- [ ] Call back\n')
  })
})

describe('md', () => {
  const short = { ...source, turns: source.turns.slice(0, 1) }

  test('a title, a turn under its speaker and time, a paragraph per segment', () => {
    expect(exportContents(short, all).md).toBe('# Weekly sync\n\n**Anna** [00:00]\n\nHello.\n\nSecond line.\n')
  })

  test('takes out the time, the speaker, or both', () => {
    expect(exportContents(short, { timestamps: false, speakers: true }).md).toBe('# Weekly sync\n\n**Anna**\n\nHello.\n\nSecond line.\n')
    expect(exportContents(short, { timestamps: true, speakers: false }).md).toBe('# Weekly sync\n\n[00:00]\n\nHello.\n\nSecond line.\n')
    expect(exportContents(short, { timestamps: false, speakers: false }).md).toBe('# Weekly sync\n\nHello.\n\nSecond line.\n')
  })

  test('the note closes it, and an empty one adds nothing', () => {
    expect(exportContents({ ...short, note: '**Done**' }, all).md).toMatch(/Second line\.\n\n## Notes\n\n\*\*Done\*\*\n$/)
    expect(exportContents({ ...short, note: null }, all).md).not.toContain('Notes')
  })
})

describe('json', () => {
  const parsed = (change: Partial<ExportSource> = {}, options = all) => JSON.parse(exportContents({ ...source, ...change }, options).json)

  test('each segment under its effective speaker, as the Editor labels them', () => {
    const data = parsed()
    expect(data.title).toBe('Weekly sync')
    expect(data.language).toBe('en')
    expect(data.segments.map((row: { speaker: string }) => row.speaker)).toEqual(['Anna', 'Anna', 'Mark', 'Unknown speaker 1', 'Unassigned'])
    expect(data.segments[2]).toEqual({ start: 65, end: 67, speaker: 'Mark', text: 'Hi.' })
  })

  test('a switched-off option takes its fields out', () => {
    expect(parsed({}, { timestamps: false, speakers: true }).segments[0]).toEqual({ speaker: 'Anna', text: 'Hello.' })
    expect(parsed({}, { timestamps: true, speakers: false }).segments[0]).toEqual({ start: 0, end: 2, text: 'Hello.' })
    expect(parsed({}, { timestamps: false, speakers: false }).segments[0]).toEqual({ text: 'Hello.' })
  })

  test('"note" is there only with notes on', () => {
    expect('note' in parsed()).toBe(false)
    expect(parsed({ note: null }).note).toBeNull()
    expect(parsed({ note: 'Text' }).note).toBe('Text')
  })
})
