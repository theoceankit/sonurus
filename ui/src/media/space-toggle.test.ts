import { afterEach, expect, test } from 'vitest'
import { spaceAction, type SpaceKey } from './space-toggle'

afterEach(() => {
  document.body.innerHTML = ''
})

const space = (changes: Partial<SpaceKey> = {}): SpaceKey => ({
  key: ' ', repeat: false, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, isComposing: false, ...changes,
})

const make = (html: string, selector: string) => {
  document.body.innerHTML = html
  return document.querySelector(selector)!
}

const free = { overlayOpen: false, pointerFocused: null }
// How the focus came: from a click the element is the one the pointer focused.
const by = (element: Element, way: 'keyboard' | 'pointer') => ({ overlayOpen: false, pointerFocused: way === 'pointer' ? element : null })

test('nothing in focus: space plays and pauses', () => {
  expect(spaceAction(space(), document.body, free)).toBe('toggle')
})

test('a paragraph of the transcript: space plays and pauses', () => {
  const paragraph = make('<div role="group"><div data-nav tabindex="0">Hello</div></div>', '[data-nav]')
  expect(spaceAction(space(), paragraph, free)).toBe('toggle')
})

test('the Position slider and the volume slider: space plays and pauses', () => {
  const slider = make('<div role="slider" tabindex="0" aria-label="Position"></div>', '[role="slider"]')
  expect(spaceAction(space(), slider, free)).toBe('toggle')
})

test('a text field keeps the space', () => {
  for (const html of ['<input>', '<input type="search">', '<textarea></textarea>', '<div contenteditable="true"></div>']) {
    const field = make(html, 'body > *')
    expect(spaceAction(space(), field, free), html).toBe('pass')
  }
})

test('a checkbox or a range is not a text field', () => {
  const box = make('<input type="checkbox">', 'input')
  expect(spaceAction(space(), box, by(box, 'pointer'))).toBe('toggle')
  const range = make('<input type="range">', 'input')
  expect(spaceAction(space(), range, free)).toBe('toggle')
})

test('a button reached from the keyboard is pressed by the space', () => {
  const button = make('<button>Rewind</button>', 'button')
  expect(spaceAction(space(), button, by(button, 'keyboard'))).toBe('pass')
})

test('a button left in focus by a click: space plays and pauses instead', () => {
  const button = make('<button>Rewind</button>', 'button')
  expect(spaceAction(space(), button, by(button, 'pointer'))).toBe('toggle')
})

test('a button the pointer focused is not the one in focus now: pressed as before', () => {
  document.body.innerHTML = '<button id="a">A</button><button id="b">B</button>'
  const [a, b] = [document.getElementById('a')!, document.getElementById('b')!]
  expect(spaceAction(space(), b, { overlayOpen: false, pointerFocused: a })).toBe('pass')
})

test('other controls the space presses follow the same rule', () => {
  for (const html of ['<div role="button" tabindex="0"></div>', '<div role="switch" tabindex="0"></div>', '<div role="tab" tabindex="0"></div>', '<div role="combobox" tabindex="0"></div>']) {
    const control = make(html, 'body > *')
    expect(spaceAction(space(), control, by(control, 'keyboard')), html).toBe('pass')
    expect(spaceAction(space(), control, by(control, 'pointer')), html).toBe('toggle')
  }
})

test('an open modal window keeps the space', () => {
  expect(spaceAction(space(), document.body, { overlayOpen: true, pointerFocused: null })).toBe('pass')
})

test('focus inside a menu, a select list or a popover keeps the space', () => {
  for (const role of ['menu', 'listbox', 'dialog', 'alertdialog']) {
    const item = make(`<div role="${role}"><div tabindex="0" id="in"></div></div>`, '#in')
    expect(spaceAction(space(), item, free), role).toBe('pass')
  }
})

test('a held space plays or pauses once: the repeats are swallowed', () => {
  expect(spaceAction(space({ repeat: true }), document.body, free)).toBe('swallow')
})

test('a held space in a field is still typed', () => {
  const field = make('<input>', 'input')
  expect(spaceAction(space({ repeat: true }), field, free)).toBe('pass')
})

test('space with a modifier is left alone', () => {
  for (const modifier of ['ctrlKey', 'altKey', 'shiftKey', 'metaKey'] as const) {
    expect(spaceAction(space({ [modifier]: true }), document.body, free), modifier).toBe('pass')
  }
})

test('other keys and composing text are left alone', () => {
  expect(spaceAction(space({ key: 'Enter' }), document.body, free)).toBe('pass')
  expect(spaceAction(space({ key: 'k' }), document.body, free)).toBe('pass')
  expect(spaceAction(space({ isComposing: true }), document.body, free)).toBe('pass')
})
