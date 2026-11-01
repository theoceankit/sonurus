import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Icon } from './Icon'
import css from './Icon.module.css?raw'
import { iconNames } from './icon-names'

const files = import.meta.glob<string>('../../assets/icons/*.svg', { query: '?raw', import: 'default', eager: true })
const fileName = (path: string) => path.split('/').pop()!.replace('.svg', '')

test('the list of names matches the files', () => {
  expect([...iconNames].sort()).toEqual(Object.keys(files).map(fileName).sort())
})

test.each(Object.keys(files).map(fileName))('%s is a clean file on the 24 grid that takes the colour of its text', name => {
  const svg = files[`../../assets/icons/${name}.svg`]
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"/)
  expect(svg).toMatch(/<path /)
  expect(svg.match(/<[a-z]+/g)!.filter(tag => tag !== '<svg' && tag !== '<path')).toEqual([])
  expect(svg).not.toMatch(/\son\w+=|style=|#[0-9a-fA-F]{3,8}\b|rgb\(/)
  for (const [, paint] of svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)) {
    expect(['none', 'currentColor']).toContain(paint)
  }
})

test.each(iconNames)('%s renders its shapes', name => {
  const { container } = render(<Icon name={name} />)
  expect(container.querySelectorAll('svg > path').length).toBeGreaterThan(0)
})

test('is hidden from assistive technology without a label', () => {
  const { container } = render(<Icon name="search" />)
  const svg = container.querySelector('svg')!
  expect(svg.getAttribute('aria-hidden')).toBe('true')
  expect(svg.getAttribute('role')).toBeNull()
})

test('is an image with a label', () => {
  render(<Icon name="search" label="Search" />)
  expect(screen.getByRole('img', { name: 'Search' }).getAttribute('aria-hidden')).toBeNull()
})

test.each([[12], [14], [16], [20], [24]] as const)('size %i selects its class', size => {
  const { container } = render(<Icon name="add" size={size} />)
  expect(container.querySelector('svg')!.getAttribute('class')).toContain(`size${size}`)
})

test('defaults to 16 and keeps a passed class', () => {
  const { container } = render(<Icon name="add" className="mine" />)
  const classes = container.querySelector('svg')!.getAttribute('class')
  expect(classes).toContain('size16')
  expect(classes).toContain('mine')
})

test.each([
  ['size12', '--size-icon-xs', '1px'],
  ['size14', '--size-icon-xs-plus', '1px'],
  ['size16', '--size-icon-sm', '1px'],
  ['size20', '--size-icon-md', '1.25px'],
  ['size24', '--size-icon-lg', '1.5px'],
])('%s has the agreed box and stroke', (name, token, stroke) => {
  const rule = css.match(new RegExp(`\\.${name} \\{([^}]+)\\}`))![1]
  expect(rule).toContain(`width: var(${token})`)
  expect(rule).toContain(`stroke-width: ${stroke}`)
})

test('the stroke does not scale with the icon', () => {
  expect(css).toContain('vector-effect: non-scaling-stroke')
})
