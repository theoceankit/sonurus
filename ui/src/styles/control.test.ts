import { expect, test } from 'vitest'
import css from './control.module.css?raw'

// composes brings these rules in with whichever module loads first, so their place
// in the cascade depends on the order of imports. With no specificity of their own
// they lose to a component's rules wherever they land.
test('the shared rules have no specificity', () => {
  const selectors = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map(rule => rule.split('{')[0].trim())
    .filter(Boolean)
  expect(selectors.length).toBeGreaterThan(0)
  for (const selector of selectors) {
    for (const part of selector.split(/,\s*(?![^(]*\))/)) expect(part).toMatch(/^:where\(/)
  }
})
