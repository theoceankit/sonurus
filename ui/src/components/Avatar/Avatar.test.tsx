import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Avatar } from './Avatar'
import { speakerInitials } from './initials'

const avatar = (ui: Parameters<typeof render>[0]) => render(ui).container.firstElementChild as HTMLElement

describe('speakerInitials', () => {
  test.each([
    ['Alice Brown', 'AB'],
    ['Bob', 'BO'],
    ['Anna Maria Petrova', 'AP'],
    ['  Zoe   Quinn ', 'ZQ'],
    ['анна петрова', 'АП'],
    ['A', 'A'],
    ['', ''],
    ['   ', ''],
  ])('%j gives %j', (name, initials) => {
    expect(speakerInitials(name)).toBe(initials)
  })
})

describe('named speaker', () => {
  test('gets initials, the colour of its number and a size class', () => {
    const el = avatar(<Avatar name="Alice Brown" color={3} size="small" />)
    expect(el.textContent).toBe('AB')
    expect(el.style.background).toBe('var(--color-speaker-3-bg)')
    expect(el.style.color).toBe('var(--color-speaker-3-fg)')
    expect(el.className).toMatch(/\bsmall\b/)
  })

  test('size comes from CSS only, never inline', () => {
    const el = avatar(<Avatar name="Alice Brown" color={1} size="large" />)
    for (const prop of ['width', 'height', 'fontSize'] as const) expect(el.style[prop]).toBe('')
  })

  test('default size is medium', () => {
    expect(avatar(<Avatar name="Bob" color={1} />).className).toMatch(/\bmedium\b/)
  })

  test('xs has room for one letter', () => {
    expect(avatar(<Avatar name="Alice Brown" color={1} size="xs" />).textContent).toBe('A')
    expect(avatar(<Avatar name="Bob" color={1} size="xs" />).textContent).toBe('B')
  })

  test('empty name is a circle without letters', () => {
    expect(avatar(<Avatar name="" color={1} />).textContent).toBe('')
    expect(avatar(<Avatar name="   " color={1} />).textContent).toBe('')
  })

  test('follows a changed name in place', () => {
    const { container, rerender } = render(<Avatar name="" color={2} />)
    const el = container.firstElementChild as HTMLElement
    rerender(<Avatar name="Ann Lee" color={4} />)
    expect(container.firstElementChild).toBe(el)
    expect(el.textContent).toBe('AL')
    expect(el.style.background).toBe('var(--color-speaker-4-bg)')
    rerender(<Avatar name="   " color={4} />)
    expect(el.textContent).toBe('')
  })
})

test.each(['unknown', 'unassigned'] as const)('%s is a gray "?" at every size', kind => {
  for (const size of ['xs', 'small', 'medium', 'large'] as const) {
    const el = avatar(<Avatar kind={kind} size={size} />)
    expect(el.textContent).toBe('?')
    expect(el.style.background).toBe('var(--color-speaker-6-bg)')
    expect(el.className).toMatch(new RegExp(`\\b${size}\\b`))
  }
})

test('a size outside the presets, or a name without a colour, is a type error', () => {
  const wrong = () => [
    // @ts-expect-error not a preset
    <Avatar name="A" color={1} size={28} />,
    // @ts-expect-error not a preset
    <Avatar name="A" color={1} size="xl" />,
    // @ts-expect-error a named speaker needs a colour
    <Avatar name="A" />,
    // @ts-expect-error colours are 1 to 6
    <Avatar name="A" color={7} />,
  ]
  expect(wrong).toBeTypeOf('function')
})

const moduleCss = import.meta.glob<string>('./Avatar.module.css', { query: '?raw', import: 'default', eager: true })
const sources = import.meta.glob<string>(['../../**/*.{ts,tsx}', '!../../**/*.test.*'], { query: '?raw', import: 'default', eager: true })

describe('guards', () => {
  test('initials cannot be selected', () => {
    expect(moduleCss['./Avatar.module.css']).toMatch(/\.avatar \{[^}]*user-select: none/)
  })

  test('every size has a rule with its width, height and font', () => {
    for (const size of ['xs', 'small', 'medium', 'large']) {
      const rule = moduleCss['./Avatar.module.css'].match(new RegExp(`\\.${size} \\{([^}]*)\\}`))?.[1]
      expect(rule, size).toBeTruthy()
      for (const prop of ['width', 'height', 'font']) expect(rule).toMatch(new RegExp(`(^|\\s)${prop}:`))
    }
  })

  test('the walk finds the sources', () => {
    expect(Object.keys(sources)).toContain('../AvatarStack/AvatarStack.tsx')
  })

  test('speaker initials are worked out only by Avatar', () => {
    const found = Object.keys(sources)
      .filter(file => !file.startsWith('./'))
      .filter(file => /\bspeakerInitials\b|Avatar\/initials|\/initials['"]/.test(sources[file]))
    expect(found, 'use <Avatar> instead of drawing initials by hand').toEqual([])
  })
})
