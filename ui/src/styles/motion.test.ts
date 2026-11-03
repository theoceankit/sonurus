import { expect, test } from 'vitest'
import control from './control.module.css?raw'
import motion from './motion.module.css?raw'

const modules = import.meta.glob<string>('../components/*/*.module.css', { query: '?raw', import: 'default', eager: true })
const css = (name: string) => modules[`../components/${name}/${name}.module.css`]

test('the state layer moves to Hover and goes straight to Pressed', () => {
  expect(control).toMatch(/\.stateLayer\)::before \{[^}]*transition: background-color var\(--duration-fast\) var\(--ease-standard\)/)
  expect(control).toMatch(/:active\)::before \{[^}]*transition: none/)
})

test.each(['Disclosure', 'Paragraph', 'ScrollBar', 'SpeakerRow', 'Tab'])('hover on %s moves with the fast duration', name => {
  expect(css(name)).toMatch(/transition: [\w-]+ var\(--duration-fast\) var\(--ease-standard\)/)
})

test('the focus ring does not move', () => {
  expect(control).not.toMatch(/focus-visible[^}]*transition/)
})

test('a tooltip shown at once has no animation, a delayed one has', () => {
  const rule = motion.slice(0, motion.indexOf('@keyframes'))
  expect(rule).toContain("delayed-open")
  expect(rule).not.toContain('instant-open')
})

test.each(['Tooltip', 'Menu', 'Player'])('%s appears and goes through the shared rules', name => {
  expect(css(name)).toMatch(/composes: presence[^;]* from '..\/..\/styles\/motion.module.css'/)
})
