import { expect, test } from 'vitest'
import { fileUrl } from './file-url'

test('plain POSIX path', () => {
  expect(fileUrl('/home/u/rec.wav')).toBe('file:///home/u/rec.wav')
})

test('spaces and Cyrillic are percent-encoded', () => {
  expect(fileUrl('/home/u/Запись 1.wav')).toBe(`file:///home/u/${encodeURIComponent('Запись 1.wav')}`)
})

test('# and ? survive', () => {
  expect(fileUrl('/a/b#1?.wav')).toBe('file:///a/b%231%3F.wav')
})

test('Windows drive letter is kept', () => {
  expect(fileUrl('C:\\Users\\u\\rec.wav')).toBe('file:///C:/Users/u/rec.wav')
})

test('the result is stable under URL normalisation', () => {
  for (const path of ['/home/u/Запись 1.wav', '/tmp/a#1?.wav', 'C:\\x y\\z.wav', "/a/(b)'c.wav"]) {
    expect(new URL(fileUrl(path)).href).toBe(fileUrl(path))
  }
})
