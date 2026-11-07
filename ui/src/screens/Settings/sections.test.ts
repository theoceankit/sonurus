import { expect, test } from 'vitest'
import { formatAppVersion } from './sections'

test('the version line: product name and version', () => {
  expect(formatAppVersion('0.3.0')).toBe('Sonorus 0.3.0')
  expect(formatAppVersion(' 0.3.0 ')).toBe('Sonorus 0.3.0')
})

test('the version line: the product name alone when the version is missing', () => {
  for (const version of [undefined, null, '', '  ', 'unknown', 42]) expect(formatAppVersion(version)).toBe('Sonorus')
})
