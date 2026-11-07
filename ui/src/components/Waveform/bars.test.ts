import { expect, test } from 'vitest'
import { BAR_COUNT, smallBarCount } from './bars'
import waveformCss from './Waveform.module.css?raw'
import tokensCss from '../../styles/tokens.css?raw'

test('a small waveform has as many bars as fit its width, each as wide as the token', () => {
  // 3 px bars with 2 px between them: n bars take 5n - 2 px.
  expect(smallBarCount(136, 3, 2)).toBe(27)
  expect(smallBarCount(380, 3, 2)).toBe(76)
  expect(smallBarCount(133, 3, 2)).toBe(27)
  expect(smallBarCount(132, 3, 2)).toBe(26)
  expect(smallBarCount(3, 3, 2)).toBe(1)
})

test('before the width is known, the count stays what it was', () => {
  expect(smallBarCount(0, 3, 2)).toBe(BAR_COUNT.small)
  expect(smallBarCount(200, 0, 2)).toBe(BAR_COUNT.small)
})

test('small bars keep their width and do not stretch', () => {
  expect(tokensCss).toMatch(/--size-waveform-bar-small: \d+px;/)
  expect(waveformCss).toMatch(/\.small \.bar \{[^}]*flex: none;[^}]*width: var\(--size-waveform-bar-small\);/)
})
