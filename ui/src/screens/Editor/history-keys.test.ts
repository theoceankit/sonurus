import { afterEach, expect, test } from 'vitest'
import { historyButton, historyKey, type HistoryKey } from './history-keys'

afterEach(() => {
  document.body.innerHTML = ''
})

const press = (key: string, code: string, changes: Partial<HistoryKey> = {}): HistoryKey => ({
  key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, isComposing: false, ...changes,
})
const altLeft = (changes: Partial<HistoryKey> = {}) => press('ArrowLeft', 'ArrowLeft', { altKey: true, ...changes })
const altRight = press('ArrowRight', 'ArrowRight', { altKey: true })
const cmdBracket = (code: 'BracketLeft' | 'BracketRight', key = code === 'BracketLeft' ? '[' : ']', changes: Partial<HistoryKey> = {}) =>
  press(key, code, { metaKey: true, ...changes })

const make = (html: string, selector: string) => {
  document.body.innerHTML = html
  return document.querySelector(selector)!
}

const free = { overlayOpen: false, layerShown: false }

test('Alt with an arrow goes back and forward on Linux and Windows', () => {
  expect(historyKey(altLeft(), document.body, free, 'other')).toBe('back')
  expect(historyKey(altRight, null, free, 'other')).toBe('forward')
  expect(historyKey(cmdBracket('BracketLeft'), document.body, free, 'other')).toBe('pass')
})

test('⌘ with a bracket goes back and forward on macOS, in any layout', () => {
  expect(historyKey(cmdBracket('BracketLeft'), document.body, free, 'mac')).toBe('back')
  expect(historyKey(cmdBracket('BracketRight'), document.body, free, 'mac')).toBe('forward')
  expect(historyKey(cmdBracket('BracketLeft', 'х'), document.body, free, 'mac')).toBe('back')
  expect(historyKey(altLeft(), document.body, free, 'mac')).toBe('pass')
})

test('other keys, the arrows alone and other modifiers pass', () => {
  expect(historyKey(press('ArrowLeft', 'ArrowLeft'), document.body, free, 'other')).toBe('pass')
  expect(historyKey(press('ArrowUp', 'ArrowUp', { altKey: true }), document.body, free, 'other')).toBe('pass')
  for (const modifier of ['ctrlKey', 'shiftKey', 'metaKey', 'isComposing'] as const) {
    expect(historyKey(altLeft({ [modifier]: true }), document.body, free, 'other'), modifier).toBe('pass')
  }
  for (const modifier of ['ctrlKey', 'shiftKey', 'altKey'] as const) {
    expect(historyKey(cmdBracket('BracketLeft', '[', { [modifier]: true }), document.body, free, 'mac'), modifier).toBe('pass')
  }
})

test('works from a button, a row of the sidebar or the waveform', () => {
  expect(historyKey(altLeft(), make('<button>Weekly product sync</button>', 'button'), free, 'other')).toBe('back')
  expect(historyKey(altLeft(), make('<div role="slider" tabindex="0"></div>', 'div'), free, 'other')).toBe('back')
})

test('a field being typed in keeps its arrows', () => {
  for (const html of ['<input>', '<input type="search">', '<textarea></textarea>', '<div contenteditable="true"><span>x</span></div>']) {
    const field = make(html, 'input, textarea, span')
    expect(historyKey(altLeft(), field, free, 'other'), html).toBe('pass')
  }
})

test('a window, a menu, a select list or a popover keeps its keys', () => {
  expect(historyKey(altLeft(), document.body, { overlayOpen: true, layerShown: false }, 'other')).toBe('pass')
  expect(historyKey(altLeft(), document.body, { overlayOpen: false, layerShown: true }, 'other')).toBe('pass')
  expect(historyKey(altLeft(), make('<div role="menu"><button>Rename</button></div>', 'button'), free, 'other')).toBe('pass')
})

test('the side buttons of a mouse go back and forward, wherever the focus is', () => {
  expect(historyButton(3, free)).toBe('back')
  expect(historyButton(4, free)).toBe('forward')
  expect(historyButton(0, free)).toBe('pass')
  expect(historyButton(2, free)).toBe('pass')
})

test('the side buttons do nothing over a window, a menu or a popover', () => {
  expect(historyButton(3, { overlayOpen: true, layerShown: false })).toBe('pass')
  expect(historyButton(4, { overlayOpen: false, layerShown: true })).toBe('pass')
})
