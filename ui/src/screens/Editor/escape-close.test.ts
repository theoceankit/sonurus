import { afterEach, expect, test } from 'vitest'
import { escapeAction, type EscapeKey } from './escape-close'

afterEach(() => {
  document.body.innerHTML = ''
})

const escape = (changes: Partial<EscapeKey> = {}): EscapeKey => ({
  key: 'Escape', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, isComposing: false, ...changes,
})

const make = (html: string, selector: string) => {
  document.body.innerHTML = html
  return document.querySelector(selector)!
}

const free = { overlayOpen: false, layerShown: false }

test('closes with nothing in focus, or a paragraph of the transcript', () => {
  expect(escapeAction(escape(), document.body, free)).toBe('close')
  expect(escapeAction(escape(), null, free)).toBe('close')
  expect(escapeAction(escape(), make('<p tabindex="0">Text</p>', 'p'), free)).toBe('close')
})

test('closes from a button or a row of the sidebar, however it got the focus', () => {
  expect(escapeAction(escape(), make('<button>Weekly product sync</button>', 'button'), free)).toBe('close')
  expect(escapeAction(escape(), make('<div role="slider" tabindex="0"></div>', 'div'), free)).toBe('close')
  expect(escapeAction(escape(), make('<input type="checkbox">', 'input'), free)).toBe('close')
})

test('other keys and Escape with a modifier or during composition pass', () => {
  expect(escapeAction(escape({ key: 'Enter' }), document.body, free)).toBe('pass')
  for (const modifier of ['ctrlKey', 'altKey', 'shiftKey', 'metaKey', 'isComposing'] as const) {
    expect(escapeAction(escape({ [modifier]: true }), document.body, free), modifier).toBe('pass')
  }
})

test('a field being typed in keeps Escape', () => {
  for (const html of ['<input>', '<input type="search">', '<textarea></textarea>', '<div contenteditable="true"><span>x</span></div>']) {
    const field = make(html, 'input, textarea, span')
    expect(escapeAction(escape(), field, free), html).toBe('pass')
  }
})

test('a window or a layer on the screen takes Escape first', () => {
  expect(escapeAction(escape(), document.body, { overlayOpen: true, layerShown: false })).toBe('pass')
  expect(escapeAction(escape(), document.body, { overlayOpen: false, layerShown: true })).toBe('pass')
})

test('the focus in a menu, a list or a popover passes', () => {
  for (const role of ['menu', 'listbox', 'dialog', 'alertdialog']) {
    const item = make(`<div role="${role}"><button>Item</button></div>`, 'button')
    expect(escapeAction(escape(), item, free), role).toBe('pass')
  }
})
