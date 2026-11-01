import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import { AvatarStack, type StackSpeaker } from './AvatarStack'

const ALICE: StackSpeaker = { id: 'a', name: 'Alice Brown', color: 1, title: 'Alice Brown' }
const BOB: StackSpeaker = { id: 'b', name: 'Bob', color: 3, title: 'Bob' }
const UNKNOWN: StackSpeaker = { id: 'c', kind: 'unknown' }
const LENA: StackSpeaker = { id: 'd', name: 'Lena Kovacs', color: 4 }

const children = (ui: Parameters<typeof render>[0]) =>
  [...render(ui).container.firstElementChild!.children] as HTMLElement[]

test('at most max avatars, the first one on top, the rest as "+N" below them all', () => {
  const items = children(<AvatarStack speakers={[ALICE, UNKNOWN, BOB, LENA]} size="small" max={3} />)
  expect(items.map(c => c.textContent)).toEqual(['AB', '?', 'BO', '+1'])
  expect(items.slice(0, 3).map(c => c.style.zIndex)).toEqual(['3', '2', '1'])
  expect(items[3].style.zIndex).toBe('')
  expect(items.slice(0, 3).every(c => /\bsmall\b/.test(c.className))).toBe(true)
})

test('nothing extra when everyone fits', () => {
  expect(children(<AvatarStack speakers={[ALICE, BOB]} max={3} />).map(c => c.textContent)).toEqual(['AB', 'BO'])
  expect(children(<AvatarStack speakers={[ALICE, BOB]} />)).toHaveLength(2)
  expect(children(<AvatarStack speakers={[]} />)).toHaveLength(0)
})

test('xs avatars show one letter', () => {
  expect(children(<AvatarStack speakers={[ALICE, BOB]} size="xs" />).map(c => c.textContent)).toEqual(['A', 'B'])
})

test('a title shows the name on hover, without one there is none', () => {
  const items = children(<AvatarStack speakers={[ALICE, LENA]} />)
  expect(items.map(c => c.title)).toEqual(['Alice Brown', ''])
})
