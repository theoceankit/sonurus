import { describe, expect, test } from 'vitest'
import { speaker } from '../../api/fixtures/data'
import { mentionCandidates } from './note-speakers'

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
