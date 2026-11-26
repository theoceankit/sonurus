import { describe, expect, test } from 'vitest'
import { speaker } from '../../api/fixtures/data'
import { mentionCandidates, speakerFinder } from './note-speakers'

const anna = speaker('a', 'Anna Petrova', 0, 3)
const mark = speaker('m', 'Mark Ellis', 1, 2)
const lena = speaker('l', 'Lena Kovacs', 2, 1)
const unnamed = speaker('u', null, 3, 1)

describe('who @ offers', () => {
  test('the speakers of the recording first, as they first speak there; then the rest as the list has them', () => {
    const found = mentionCandidates([anna, mark, lena, unnamed], ['l', 'u', 'a'])
    expect(found.map(c => [c.id, c.inRecording])).toEqual([['l', true], ['a', true], ['m', false]])
  })

  test('a speaker without a name is no one to mention yet', () => {
    expect(mentionCandidates([unnamed], ['u'])).toEqual([])
  })
})

describe('a speaker of a note', () => {
  const find = speakerFinder([anna, unnamed])

  test('a named speaker as they are now', () => {
    expect(find('a')).toMatchObject({ name: 'Anna Petrova', handle: anna.handle })
  })

  test('a voice with no name yet is there, without a name', () => {
    expect(find('u')).toEqual({ name: null })
  })

  test('a speaker no longer in the base is no one', () => {
    expect(find('gone')).toBeNull()
  })
})
