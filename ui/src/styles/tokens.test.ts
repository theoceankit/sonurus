import { expect, test } from 'vitest'
import { parseTokens } from './tokens'
import css from './tokens.css?raw'

const tokens = parseTokens(css)
const names = (list: { name: string }[]) => list.map(t => t.name)
const refs = (value: string) => [...value.matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1])

test('every layer is read from the file', () => {
  for (const layer of Object.values(tokens)) expect(layer.length).toBeGreaterThan(0)
  expect(names(tokens.palette)).toContain('--iris-600')
  expect(names(tokens.scale)).toContain('--space-half')
  expect(names(tokens.type)).toContain('--font-body')
  expect(names(tokens.light)).toContain('--shadow-sm')
})

test('both themes define the same tokens', () => {
  expect(names(tokens.dark).sort()).toEqual(names(tokens.light).sort())
})

test('a token is defined once in its layer', () => {
  for (const layer of Object.values(tokens)) {
    expect(new Set(names(layer)).size).toBe(layer.length)
  }
})

test('every reference points at a token that exists', () => {
  const known = new Set(names([...tokens.palette, ...tokens.scale, ...tokens.type, ...tokens.light]))
  for (const { name, value } of [...tokens.type, ...tokens.light, ...tokens.dark]) {
    for (const ref of refs(value)) expect(known.has(ref), `${name} uses ${ref}`).toBe(true)
  }
})

test('the palette holds values and references nothing', () => {
  for (const { name, value } of tokens.palette) expect(refs(value), name).toEqual([])
})

test('semantic colours come from the palette, never from a raw value', () => {
  const palette = new Set(names(tokens.palette))
  for (const { name, value } of [...tokens.light, ...tokens.dark]) {
    if (!name.startsWith('--color-')) continue
    expect(palette.has(refs(value)[0]), `${name}: ${value}`).toBe(true)
  }
})

test('reduced motion takes away distance only', () => {
  const block = css.slice(css.indexOf('/* Reduced motion'))
  expect(block).toContain('prefers-reduced-motion: reduce')
  expect([...block.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]).sort()).toEqual(['--motion-scale', '--motion-shift-md', '--motion-shift-sm'])
})
