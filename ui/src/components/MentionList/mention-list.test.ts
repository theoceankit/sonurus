import { describe, expect, test } from 'vitest'
import { mentionList, type MentionCandidate } from './mention-list'

const candidate = (id: string, name: string, handle: string, inRecording: boolean): MentionCandidate => ({ id, name, handle, color: 1, inRecording })
const PEOPLE = [
  candidate('a', 'Anna Petrova', 'anna', true),
  candidate('d', 'Daniel Brooks', 'dan', false),
  candidate('h', 'Hanna Lind', 'hanna', false),
  candidate('m', 'Mark Ellis', 'mark', true),
]

const names = (query: string) => mentionList(PEOPLE, query).sections.map(section => [section.title, section.options.map(option => option.kind === 'speaker' ? option.speaker.name : `Mention "${option.name}"`)])

describe('mentionList', () => {
  test('speakers of the recording come first, then the others, and nothing to mention as typed', () => {
    expect(names('')).toEqual([
      ['In this recording', ['Anna Petrova', 'Mark Ellis']],
      ['Other speakers', ['Daniel Brooks', 'Hanna Lind']],
    ])
  })

  test('a search keeps both groups and ends with the text as it was typed', () => {
    expect(names('anna')).toEqual([
      ['In this recording', ['Anna Petrova']],
      ['Other speakers', ['Hanna Lind']],
      ['', ['Mention "anna"']],
    ])
  })

  test('finds by handle, with or without the @', () => {
    expect(names('@dan')[0]).toEqual(['Other speakers', ['Daniel Brooks']])
    expect(names('DAN')[0]).toEqual(['Other speakers', ['Daniel Brooks']])
  })

  test('nobody found leaves only the person as typed', () => {
    expect(names('Slack Person')).toEqual([['', ['Mention "Slack Person"']]])
  })

  test('the options are the sections in order, for the arrow keys', () => {
    const { options } = mentionList(PEOPLE, 'an')
    expect(options.map(option => option.kind === 'speaker' ? option.speaker.id : option.name)).toEqual(['a', 'd', 'h', 'an'])
  })
})
