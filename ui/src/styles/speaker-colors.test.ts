import { expect, test } from 'vitest'
import { speakerColor } from './speaker-colors'

test('an index from the backend becomes a colour of the six, and wraps', () => {
  expect([0, 4, 5, 6].map(speakerColor)).toEqual([1, 5, 6, 1])
})
