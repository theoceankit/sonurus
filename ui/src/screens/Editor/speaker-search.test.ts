import { describe, expect, test } from 'vitest'
import { CANDIDATES, SPEAKERS, SPEAKER_IDS } from '../../api/fixtures/data'
import { chooseSpeakerList, preselectedSpeaker } from './speaker-search'

const { anna, mark, lena, priya, unknown1 } = SPEAKER_IDS
const candidates = CANDIDATES[unknown1].candidates
const list = (changes = {}) => chooseSpeakerList({ speakers: SPEAKERS, candidates, recordingSpeakers: [anna, mark, unknown1], query: '', category: 'all', ...changes })

describe('sections', () => {
  test('all speakers: the matches, then everyone else with a name', () => {
    const { sections } = list()
    expect(sections.map(section => section.title)).toEqual(['Best voice matches', 'Other speakers'])
    expect(sections[0].rows.map(row => row.id)).toEqual([mark, lena, priya])
    expect(sections[1].rows).toHaveLength(10)
    expect(sections[1].rows.map(row => row.id)).not.toContain(mark)
    expect(sections[1].rows.map(row => row.id)).not.toContain(unknown1)
  })

  test('a match shows its percentage and mark, another speaker their recordings', () => {
    const { sections } = list()
    expect(sections[0].rows[0]).toMatchObject({ name: 'Mark Ellis', score: 0.82, suggested: true })
    expect(sections[1].rows.find(row => row.id === anna)).toMatchObject({ usage: '14 recordings' })
    expect(sections[1].rows.find(row => row.name === 'Kate Nguyen')).toMatchObject({ usage: '1 recording' })
  })

  test('best voice matches only', () => {
    const { sections } = list({ category: 'best' })
    expect(sections.map(section => section.title)).toEqual(['Best voice matches'])
  })

  test('already in this recording only, those with a name', () => {
    const { sections } = list({ category: 'recording' })
    expect(sections.map(section => section.title)).toEqual(['Already in this recording'])
    expect(sections[0].rows.map(row => row.id)).toEqual([anna, mark])
  })

  test('no candidates: no section for them', () => {
    expect(list({ candidates: [] }).sections.map(section => section.title)).toEqual(['Other speakers'])
  })

  test('a candidate no longer among the speakers is left out', () => {
    const gone = { speaker_id: 'gone', name: 'Gone', score: 0.5, suggested: false }
    expect(list({ candidates: [gone] }).sections[0].title).toBe('Other speakers')
  })
})

describe('counts', () => {
  test('per category', () => {
    expect(list().counts).toEqual({ all: 13, best: 3, recording: 2 })
  })

  test('follow the search', () => {
    expect(list({ query: 'li' }).counts).toEqual({ all: 2, best: 1, recording: 1 })
  })

  test('no results are zeros everywhere', () => {
    const result = list({ query: 'Zoe' })
    expect(result.counts).toEqual({ all: 0, best: 0, recording: 0 })
    expect(result.sections).toEqual([])
  })
})

describe('search', () => {
  const names = (query: string) => list({ query }).sections.flatMap(section => section.rows).map(row => row.name)

  test('matches any part of the name, in any case', () => {
    expect(names('ELLIS')).toEqual(['Mark Ellis'])
    expect(names('ark')).toEqual(['Mark Ellis'])
  })

  test('ignores spaces around the text', () => {
    expect(names('  ellis ')).toEqual(['Mark Ellis'])
  })

  test('speakers with no name never match', () => {
    expect(names('unknown')).toEqual([])
  })
})

describe('preselectedSpeaker', () => {
  test('what the card chose wins', () => {
    expect(preselectedSpeaker(lena, candidates)).toBe(lena)
  })

  test('otherwise the suggested candidate', () => {
    expect(preselectedSpeaker(null, candidates)).toBe(mark)
  })

  test('otherwise nobody', () => {
    expect(preselectedSpeaker(null, [{ ...candidates[0], suggested: false }])).toBe(null)
  })
})
