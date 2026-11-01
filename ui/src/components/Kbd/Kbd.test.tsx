import { render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Kbd } from './Kbd'

afterEach(() => vi.unstubAllGlobals())

test.each([
  [['mod', 'K'], 'Ctrl K', '⌘K'],
  [['mod', 'shift', 'F'], 'Ctrl Shift F', '⌘⇧F'],
  [['alt', 'Enter'], 'Alt Enter', '⌥Enter'],
  [['Esc'], 'Esc', 'Esc'],
])('%j reads %j off a Mac and %j on one', (keys, other, mac) => {
  expect(render(<Kbd keys={keys} os="other" />).container.textContent).toBe(other)
  expect(render(<Kbd keys={keys} os="mac" />).container.textContent).toBe(mac)
})

test.each([
  ['MacIntel', '⌘K'],
  ['Linux x86_64', 'Ctrl K'],
  ['Win32', 'Ctrl K'],
])('on %s it works out the system by itself', (platform, text) => {
  vi.stubGlobal('navigator', { platform })
  expect(render(<Kbd keys={['mod', 'K']} />).container.textContent).toBe(text)
})
