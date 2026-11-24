import { describe, expect, test } from 'vitest'
import { selectionQuotes, type QuoteSpeaker } from './quotes'

const LIST = `
  <div data-speaker="anna">
    <div data-segment-start="0"><p data-transcript-text="">Okay, let's get started.</p></div>
    <div data-segment-start="5"><p data-transcript-text="">The main topic is the release.</p></div>
  </div>
  <div data-speaker="u1">
    <div data-segment-start="16"><p data-transcript-text="">That was me. Files took long.</p></div>
  </div>`

const speakerOf: QuoteSpeaker = id => (id === 'anna' ? { kind: 'speaker', id, label: 'Anna Petrova' } : { kind: 'speaker', id, label: 'Unknown speaker 1' })

function select(startText: string, startAt: number, endText: string, endAt: number) {
  const list = document.createElement('div')
  list.innerHTML = LIST
  document.body.replaceChildren(list)
  const node = (text: string) => [...list.querySelectorAll('p')].find(p => p.textContent!.startsWith(text))!.firstChild!
  const range = document.createRange()
  range.setStart(node(startText), startAt)
  range.setEnd(node(endText), endAt)
  return selectionQuotes(range, list, speakerOf)
}

describe('selectionQuotes', () => {
  test('inside one paragraph: the words selected, from the paragraph start', () => {
    expect(select('The main', 4, 'The main', 14)).toEqual([
      { speaker: { kind: 'speaker', id: 'anna', label: 'Anna Petrova' }, start: 5, text: 'main topic' },
    ])
  })

  test('across two turns: a quote for each, every one from its own first paragraph', () => {
    expect(select("Okay", 6, 'That was', 12)).toEqual([
      { speaker: { kind: 'speaker', id: 'anna', label: 'Anna Petrova' }, start: 0, text: "let's get started. The main topic is the release." },
      { speaker: { kind: 'speaker', id: 'u1', label: 'Unknown speaker 1' }, start: 16, text: 'That was me.' },
    ])
  })

  test('blocks of one turn next to each other give one quote', () => {
    const list = document.createElement('div')
    list.innerHTML = `
      <div data-speaker="UNASSIGNED"><div data-segment-start="0"><p data-transcript-text="">First block ends.</p></div></div>
      <div data-speaker="UNASSIGNED"><div data-segment-start="4"><p data-transcript-text="">Second block starts.</p></div></div>`
    document.body.replaceChildren(list)
    const [first, second] = [...list.querySelectorAll('p')].map(p => p.firstChild!)
    const range = document.createRange()
    range.setStart(first, 6)
    range.setEnd(second, 6)
    expect(selectionQuotes(range, list, () => undefined)).toEqual([{ speaker: undefined, start: 0, text: 'block ends. Second' }])
  })
})
