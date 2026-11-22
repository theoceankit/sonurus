import { describe, expect, test } from 'vitest'
import { mention, paragraph, quoteBlock, text, timecode } from './note-content'
import { noteMarkdown, type ResolveSpeaker } from './note-markdown'

const resolve: ResolveSpeaker = id => ({ anna: { name: 'Anna Petrova', handle: 'anna' }, mark: { name: 'Mark Ellis', handle: null } })[id] ?? null
const md = (...content: object[]) => noteMarkdown({ type: 'doc', content }, resolve)

describe('noteMarkdown', () => {
  test('headings, marks and links', () => {
    expect(md(
      { type: 'heading', attrs: { level: 1 }, content: [text('Weekly sync')] },
      { type: 'heading', attrs: { level: 3 }, content: [text('Import')] },
      paragraph(text('Ship '), text('the fix', [{ type: 'bold' }]), text(' and '), text('tell', [{ type: 'italic' }]), text(' '), text('the docs', [{ type: 'link', attrs: { href: 'mailto:docs@example.com' } }])),
    )).toBe('# Weekly sync\n\n### Import\n\nShip **the fix** and *tell* [the docs](mailto:docs@example.com)')
  })

  test('lists, nested lists and checkboxes', () => {
    const item = (...content: object[]) => ({ type: 'listItem', content })
    const task = (checked: boolean, value: string) => ({ type: 'taskItem', attrs: { checked }, content: [paragraph(text(value))] })
    expect(md(
      { type: 'bulletList', content: [item(paragraph(text('One')), { type: 'bulletList', content: [item(paragraph(text('Inner')))] }), item(paragraph(text('Two')))] },
      { type: 'orderedList', attrs: { start: 1 }, content: [item(paragraph(text('First'))), item(paragraph(text('Second')))] },
      { type: 'taskList', content: [task(true, 'Done'), task(false, 'Open')] },
    )).toBe('- One\n  - Inner\n- Two\n\n1. First\n2. Second\n\n- [x] Done\n- [ ] Open')
  })

  test('mentions and timecodes in the agreed format', () => {
    expect(md(paragraph(
      mention({ kind: 'speaker', id: 'anna', label: 'Anna' }), text(', '),
      mention({ kind: 'speaker', id: 'mark', label: 'Mark' }), text(', '),
      mention({ kind: 'person', label: 'Slack Person' }), text(' at '), timecode(754), text(' and '), timecode(3723),
    ))).toBe('Anna Petrova (@anna), Mark Ellis, @Slack Person at [12:34] and [1:02:03]')
  })

  test('a deleted speaker is the name last seen, as text', () => {
    expect(md(paragraph(mention({ kind: 'speaker', id: 'gone', label: 'Old Name' })))).toBe('Old Name')
  })

  test('a quote: who, when and what, every line quoted', () => {
    expect(md(quoteBlock({ speaker: { kind: 'speaker', id: 'anna', label: 'Anna' }, start: 10, text: 'What about the import flow?' })))
      .toBe('> Anna Petrova (@anna) [00:10]\n>\n> What about the import flow?')
  })

  test('a quote of a recording without speakers opens with its time', () => {
    expect(md(quoteBlock({ start: 10, text: 'What about the import flow?' }))).toBe('> [00:10]\n>\n> What about the import flow?')
  })

  test('empty paragraphs are left out', () => {
    expect(md(paragraph(), paragraph(text('Only this')), paragraph())).toBe('Only this')
  })
})
