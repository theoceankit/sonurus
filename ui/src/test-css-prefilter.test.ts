import { afterEach, expect, test, vi } from 'vitest'
import { prototype, splitSelectorList } from './test-css-prefilter'

afterEach(() => {
  vi.restoreAllMocks()
  document.head.querySelectorAll('style[data-probe]').forEach(style => style.remove())
})

function addStyle(css: string) {
  const style = document.createElement('style')
  style.dataset.probe = ''
  style.textContent = css
  document.head.append(style)
}

function element(className: string, tag = 'div') {
  const node = document.createElement(tag)
  node.className = className
  document.body.append(node)
  return node
}

test('jsdom asks the patched prefilter, which finds the class inside :where()', () => {
  const extract = vi.spyOn(prototype, 'extractSubjects')
  addStyle(':where(.probeA:not(:disabled)):hover::before { color: red }')
  getComputedStyle(element('probeA'))
  const call = extract.mock.calls.findIndex(([selector]) => selector.startsWith(':where(.probeA'))
  expect(call).toBeGreaterThanOrEqual(0)
  expect(extract.mock.results[call].value).toEqual([{ attr: null, className: 'probeA', id: null, tag: null }])
})

test('the cascade is the same: a :where() rule applies to its elements and loses to any class', () => {
  addStyle(`
    :where(.probeB) { visibility: hidden; pointer-events: none }
    :where(.probeB[data-state='open']) { visibility: visible }
    .probeOther { pointer-events: auto }
    :where(.probeE .probeF) { display: none }
  `)
  const closed = element('probeB')
  const open = element('probeB')
  open.dataset.state = 'open'
  expect(getComputedStyle(closed).visibility).toBe('hidden')
  expect(getComputedStyle(open).visibility).toBe('visible')
  expect(getComputedStyle(element('probeB probeOther')).pointerEvents).toBe('auto')
  expect(getComputedStyle(element('unrelated')).visibility).toBe('visible')
  const outer = element('probeE')
  const inner = document.createElement('span')
  inner.className = 'probeF'
  outer.append(inner)
  expect(getComputedStyle(inner).display).toBe('none')
  expect(getComputedStyle(element('probeF')).display).not.toBe('none')
})

test('a selector list splits only at the commas outside brackets and strings', () => {
  expect(splitSelectorList(":where(.a:not(:disabled, [x='1,2'])), .b, [title=\"a,b\"]"))
    .toEqual([":where(.a:not(:disabled, [x='1,2']))", '.b', '[title="a,b"]'])
})

test('only a selector that is one :where() of one selector and plain pseudos gets its keys', () => {
  const extract = vi.spyOn(prototype, 'extractSubjects')
  addStyle(':where(.probeG) :where(.probeH) { color: red } :where(.probeI):not(.probeJ) { color: red } :where(.probeK, .probeL) { color: red }')
  getComputedStyle(element('probeH'))
  const keys = (start: string) => extract.mock.results[extract.mock.calls.findIndex(([s]) => s.startsWith(start))].value
  expect(keys(':where(.probeG)')).toEqual([{ attr: null, className: null, id: null, tag: null }])
  expect(keys(':where(.probeI)')).toEqual([{ attr: null, className: null, id: null, tag: null }])
  expect(keys(':where(.probeK')).toEqual([{ attr: null, className: null, id: null, tag: null }])
})
