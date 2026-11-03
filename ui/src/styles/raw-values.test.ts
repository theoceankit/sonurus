import { describe, expect, test } from 'vitest'
import { findRawInlineStyles, findRawValues } from './raw-values'
import { parseTokens } from './tokens'
import tokensCss from './tokens.css?raw'

const palette = new Set(parseTokens(tokensCss).palette.map(t => t.name))
const kinds = (css: string) => findRawValues(css, palette).map(r => r.kind)

describe('findRawValues', () => {
  test.each([
    ['#fff'], ['#5D4DBE'], ['#00000080'], ['rgb(0, 0, 0)'], ['rgba(0,0,0,0.1)'], ['hsl(0 0% 0%)'], ['oklch(50% 0.1 280)'],
    ['white'], ['black'], ['Red'],
  ])('reports the colour %s', value => {
    expect(kinds(`.a { color: ${value}; }`)).toEqual(['color'])
  })

  test('reports a colour inside a longer value and as a var() fallback', () => {
    expect(kinds('.a { border: 1px solid #000; }')).toEqual(['color'])
    expect(kinds('.a { color: var(--color-text-primary, #000); }')).toEqual(['color'])
  })

  test.each([
    ['margin'], ['margin-top'], ['margin-inline'], ['padding'], ['padding-left'], ['gap'], ['row-gap'], ['column-gap'],
    ['inset'], ['inset-block'], ['top'], ['right'], ['bottom'], ['left'],
  ])('reports a raw length in %s', property => {
    expect(kinds(`.a { ${property}: 6px; }`)).toEqual(['length'])
  })

  test('reports every unit and a negative value', () => {
    expect(kinds('.a { margin: 1rem; }')).toEqual(['length'])
    expect(kinds('.a { padding: 1.5em; }')).toEqual(['length'])
    expect(kinds('.a { margin-left: -5px; }')).toEqual(['length'])
    expect(kinds('.a { padding: var(--space-1) 12px; }')).toEqual(['length'])
  })

  test('reports the palette used directly', () => {
    expect(kinds('.a { color: var(--gray-900); }')).toEqual(['palette'])
    expect(kinds('.a { box-shadow: 0 0 0 1px var(--iris-a24); }')).toEqual(['palette'])
  })

  test.each([
    ['padding: 0'], ['margin: auto'], ['margin: 0 auto'], ['gap: var(--space-2)'], ['padding: var(--space-1) var(--space-3)'],
    ['margin-left: calc(var(--space-1) * -1)'], ['top: 50%'], ['color: var(--color-text-primary)'], ['color: currentColor'],
    ['background: transparent'], ['color: inherit'], ['border: none'],
  ])('accepts %s', declaration => {
    expect(kinds(`.a { ${declaration}; }`)).toEqual([])
  })

  test('sizes are not spacing: a fixed column width stays allowed', () => {
    expect(kinds('.a { width: 300px; height: 44px; min-width: 568px; }')).toEqual([])
  })

  test('does not read selectors or file paths as values', () => {
    expect(kinds('.a:hover { top: 0; }')).toEqual([])
    expect(kinds(".a { background: url('./red.svg'); }")).toEqual([])
    expect(kinds('.a { white-space: nowrap; }')).toEqual([])
  })

  test.each([
    ['transition: color 100ms'], ['transition-duration: 0.2s'], ['transition: all var(--duration-fast)'],
    ['transition-timing-function: ease-out'], ['animation: spin 1s linear'], ['animation-timing-function: cubic-bezier(0, 0, 1, 1)'],
    ['scale: 0.5'], ['translate: 0 4px'],
  ])('reports the raw motion in %s', declaration => {
    expect(kinds(`.a { ${declaration}; }`)).toEqual(['motion'])
  })

  test.each([
    ['transition: background-color var(--duration-fast) var(--ease-standard)'], ['animation: spin var(--duration-spin) linear infinite'],
    ['transition: none'], ['scale: var(--motion-scale)'], ['translate: 0 var(--motion-shift-md)'], ['translate: -50% 0'],
    ['transition-property: height, opacity'],
  ])('accepts %s', declaration => {
    expect(kinds(`.a { ${declaration}; }`)).toEqual([])
  })

  test('reads the last declaration without a semicolon', () => {
    expect(kinds('.a { color: #000 }')).toEqual(['color'])
  })

  test('a comment with a reason exempts the next declaration only', () => {
    const css = `.a {
  /* raw-value: avatars overlap by a fixed amount */
  margin-left: -5px;
  margin-right: -5px;
}`
    expect(findRawValues(css, palette)).toEqual([
      { line: 4, property: 'margin-right', value: '-5px', kind: 'length' },
    ])
  })

  test('a comment without a reason exempts nothing', () => {
    expect(kinds('.a {\n  /* raw-value: */\n  margin: 5px;\n}')).toEqual(['length'])
  })

  test('values in other comments are ignored', () => {
    expect(kinds('.a { /* was #000 */ color: inherit; }')).toEqual([])
  })
})

describe('findRawInlineStyles', () => {
  test('reports colours and lengths in a style prop', () => {
    expect(findRawInlineStyles('<a style={{ color: "#000" }} />')).toHaveLength(1)
    expect(findRawInlineStyles("<a style={{ padding: '4px' }} />")).toHaveLength(1)
  })

  test('accepts tokens', () => {
    expect(findRawInlineStyles("<a style={{ gap: 'var(--space-2)', background: `var(${name})` }} />")).toEqual([])
  })
})

const moduleCss = import.meta.glob<string>('../**/*.module.css', { query: '?raw', import: 'default', eager: true })
const sources = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true })

describe('the sources of the new UI', () => {
  test('the walk finds the components', () => {
    expect(Object.keys(moduleCss)).toContain('../components/Button/Button.module.css')
    expect(Object.keys(sources)).toContain('../components/Button/Button.tsx')
  })

  test.each(Object.keys(moduleCss))('%s takes colours and spacing from the tokens', file => {
    expect(findRawValues(moduleCss[file], palette)).toEqual([])
  })

  test.each(Object.keys(sources))('%s has no raw inline styles', file => {
    expect(findRawInlineStyles(sources[file])).toEqual([])
  })

  test.each(Object.keys(sources).filter(f => !f.endsWith('/Icon/Icon.tsx')))('%s draws no icons of its own', file => {
    expect(sources[file]).not.toMatch(/<svg\b/)
  })
})
