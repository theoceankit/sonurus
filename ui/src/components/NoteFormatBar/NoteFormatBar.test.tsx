import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/core'
import { GapCursor } from '@tiptap/pm/gapcursor'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'
import { NoteEditor } from '../NoteEditor/NoteEditor'
import { noteMarkdown } from '../NoteEditor/note-markdown'
import { NoteFormatBar } from './NoteFormatBar'

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...content: object[]) => ({ type: 'doc', content })
const list = (...items: string[]) => ({ type: 'bulletList', content: items.map(text => ({ type: 'listItem', content: [p(text)] })) })

function Both({ content }: { content: object }) {
  const [editor, setEditor] = useState<Editor | null>(null)
  return <RadixTooltip.Provider><NoteFormatBar editor={editor} /><NoteEditor content={content} findSpeaker={() => null} onEditor={setEditor} /></RadixTooltip.Provider>
}

function setup(content: object = doc(p('Hello world'))) {
  render(<Both content={content} />)
  const editor = (screen.getByRole('textbox', { name: 'Notes' }) as HTMLElement & { editor: Editor }).editor
  return editor
}

const press = (name: string) => {
  const button = screen.getByRole('button', { name })
  const notPrevented = fireEvent.mouseDown(button)
  fireEvent.click(button)
  return notPrevented
}
const button = (name: string) => screen.getByRole('button', { name })
const pressed = (name: string) => button(name).getAttribute('aria-pressed')
const md = (editor: Editor) => noteMarkdown(editor.getJSON(), () => null).trim()
const select = (editor: Editor, from: number, to: number) => act(() => { editor.commands.setTextSelection({ from, to }) })

describe('bold and italic', () => {
  test.each([['Bold', '**Hello** world'], ['Italic', '*Hello* world']])('%s goes on the selection, off again and back with one Undo', (name, marked) => {
    const editor = setup()
    select(editor, 1, 6)
    act(() => { press(name) })
    expect(md(editor)).toBe(marked)
    expect(pressed(name)).toBe('true')
    act(() => { press(name) })
    expect(md(editor)).toBe('Hello world')
    expect(pressed(name)).toBe('false')
    act(() => { editor.commands.undo() })
    expect(md(editor)).toBe(marked)
  })

  test('without a selection it applies to what is typed next', () => {
    const editor = setup()
    select(editor, 12, 12)
    act(() => { press('Bold') })
    expect(pressed('Bold')).toBe('true')
    act(() => { editor.commands.insertContent('!') })
    expect(md(editor)).toBe('Hello world**!**')
  })

  test('the highlight follows the cursor', () => {
    const editor = setup(doc({ type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }, { type: 'text', text: ' plain' }] }))
    select(editor, 3, 3)
    expect(pressed('Bold')).toBe('true')
    select(editor, 8, 8)
    expect(pressed('Bold')).toBe('false')
  })
})

test('a press leaves the focus in the note', async () => {
  const editor = setup()
  act(() => { editor.commands.focus(3) })
  await waitFor(() => expect(editor.isFocused).toBe(true))
  let notPrevented = true
  act(() => { notPrevented = press('Italic') })
  expect(notPrevented).toBe(false)
  await waitFor(() => expect(editor.isFocused).toBe(true))
  expect(editor.state.selection.from).toBe(3)
})

test('a format right after typing is its own step of Undo', () => {
  const editor = setup()
  act(() => { editor.commands.focus('end'); editor.commands.insertContent('!') })
  act(() => { press('Quote') })
  act(() => { editor.commands.insertContent('?') })
  act(() => { editor.commands.undo() })
  expect(md(editor)).toBe('> Hello world!')
  act(() => { editor.commands.undo() })
  expect(md(editor)).toBe('Hello world!')
})

describe('blocks', () => {
  test.each([
    ['Bulleted list', '- Hello world'],
    ['Numbered list', '1. Hello world'],
    ['Checkbox', '- [ ] Hello world'],
    ['Quote', '> Hello world'],
  ])('%s goes on, comes off, and one Undo brings it back', (name, marked) => {
    const editor = setup()
    select(editor, 3, 3)
    act(() => { press(name) })
    expect(md(editor)).toBe(marked)
    expect(pressed(name)).toBe('true')
    act(() => { press(name) })
    expect(md(editor)).toBe('Hello world')
    expect(pressed(name)).toBe('false')
    act(() => { editor.commands.undo() })
    expect(md(editor)).toBe(marked)
  })

  test.each([
    ['Bulleted list', '- One\n- Two'],
    ['Numbered list', '1. One\n2. Two'],
    ['Checkbox', '- [ ] One\n- [ ] Two'],
  ])('%s takes every paragraph selected', (name, marked) => {
    const editor = setup(doc(p('One'), p('Two')))
    select(editor, 2, 7)
    act(() => { press(name) })
    expect(md(editor).replace(/\n+/g, '\n')).toBe(marked)
  })

  test('another list type changes only the item with the cursor, in one step', () => {
    const editor = setup(doc(list('One', 'Two', 'Three')))
    select(editor, 10, 10)
    act(() => { press('Checkbox') })
    expect(editor.getJSON().content?.map(node => node.type).slice(0, 3)).toEqual(['bulletList', 'taskList', 'bulletList'])
    act(() => { editor.commands.undo() })
    expect(editor.getJSON().content?.[0].content).toHaveLength(3)
  })

  test('an item changed to the type of the list before it joins that list', () => {
    const editor = setup(doc({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('Done')] }] }, list('Next')))
    select(editor, 12, 12)
    act(() => { press('Checkbox') })
    const first = editor.getJSON().content?.[0]
    expect(first?.type).toBe('taskList')
    expect(first?.content).toHaveLength(2)
    expect((first?.content?.[0] as { attrs?: { checked?: boolean } }).attrs?.checked).toBe(true)
  })
})

test('a note just opened has the bar in use, with what holds at its start', () => {
  setup(doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] }))
  for (const name of ['Text style', 'Bold', 'Italic', 'Bulleted list', 'Numbered list', 'Checkbox', 'Quote', 'Link']) {
    expect((button(name) as HTMLButtonElement).disabled, name).toBe(false)
  }
  expect(button('Text style').textContent).toContain('H2')
})

test.each([
  ['Bulleted list', '- Title'],
  ['Numbered list', '1. Title'],
  ['Checkbox', '- [ ] Title'],
])('%s turns a heading into a list item', (name, marked) => {
  const editor = setup(doc({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] }))
  select(editor, 3, 3)
  expect((button(name) as HTMLButtonElement).disabled).toBe(false)
  act(() => { press(name) })
  expect(md(editor)).toBe(marked)
})

describe('the cursor in the free space under the text', () => {
  const atEnd = (editor: Editor) => act(() => {
    const { doc, tr } = editor.state
    editor.view.dispatch(tr.setSelection(new GapCursor(doc.resolve(doc.content.size))))
  })

  test.each(['Bulleted list', 'Numbered list', 'Checkbox', 'Quote', 'Bold', 'Italic'])('%s can be pressed', name => {
    const editor = setup(doc(list('One'), { type: 'paragraph' }))
    atEnd(editor)
    expect((button(name) as HTMLButtonElement).disabled).toBe(false)
  })

  test('a list goes on the empty paragraph there, and one Undo takes it back', () => {
    const editor = setup(doc(list('One'), { type: 'paragraph' }))
    atEnd(editor)
    act(() => { press('Checkbox') })
    expect(editor.getJSON().content?.map(node => node.type).slice(0, 2)).toEqual(['bulletList', 'taskList'])
    act(() => { editor.commands.undo() })
    expect(editor.getJSON().content?.map(node => node.type)).toEqual(['bulletList', 'paragraph'])
  })
})

describe('headings', () => {
  test.each([[1, 'H1', 'Heading 1'], [2, 'H2', 'Heading 2'], [3, 'H3', 'Heading 3']])('level %i from the menu, off again from it', async (level, short, label) => {
    const user = userEvent.setup()
    const editor = setup()
    select(editor, 3, 3)
    await user.click(button('Text style'))
    await user.click(await screen.findByRole('menuitemradio', { name: label }))
    expect(md(editor)).toBe(`${'#'.repeat(level)} Hello world`)
    await waitFor(() => expect(button('Text style').textContent).toContain(short))
    await user.click(button('Text style'))
    await user.click(await screen.findByRole('menuitemradio', { name: label }))
    expect(md(editor)).toBe('Hello world')
  })

  test('the focus is back in the note after the menu', async () => {
    const user = userEvent.setup()
    const editor = setup()
    act(() => { editor.commands.focus(3) })
    await user.click(button('Text style'))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Heading 2' }))
    await waitFor(() => expect(editor.isFocused).toBe(true))
  })
})

describe('links', () => {
  const linkDoc = () => doc({ type: 'paragraph', content: [{ type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://localhost/old' } }] }, { type: 'text', text: ' after' }] })
  const address = () => screen.findByRole('textbox', { name: 'Link address' })

  test('the selected text becomes the link', async () => {
    const user = userEvent.setup()
    const editor = setup()
    select(editor, 1, 6)
    await user.click(button('Link'))
    await user.type(await address(), 'localhost/a{Enter}')
    expect(md(editor)).toBe('[Hello](https://localhost/a) world')
    await waitFor(() => expect(editor.isFocused).toBe(true))
  })

  test('with no selection the address goes in as a link, and typing goes on outside it', async () => {
    const user = userEvent.setup()
    const editor = setup(doc(p('See ')))
    select(editor, 5, 5)
    await user.click(button('Link'))
    await user.type(await address(), 'https://localhost/a{Enter}')
    act(() => { editor.commands.insertContent('!') })
    expect(md(editor)).toBe('See [https://localhost/a](https://localhost/a)!')
  })

  test('an email address becomes a mailto link, with the email as its text', async () => {
    const user = userEvent.setup()
    const editor = setup(doc(p('Ask ')))
    select(editor, 5, 5)
    await user.click(button('Link'))
    await user.type(await address(), 'team@example.com{Enter}')
    expect(md(editor)).toBe('Ask [team@example.com](mailto:team@example.com)')
  })

  test('an email address on selected text links it to mailto', async () => {
    const user = userEvent.setup()
    const editor = setup()
    select(editor, 1, 6)
    await user.click(button('Link'))
    await user.type(await address(), 'team@example.com{Enter}')
    expect(md(editor)).toBe('[Hello](mailto:team@example.com) world')
  })

  test('on a link it changes the address of the whole link', async () => {
    const user = userEvent.setup()
    const editor = setup(linkDoc())
    select(editor, 3, 3)
    await user.click(button('Link'))
    const field = await address()
    expect((field as HTMLInputElement).value).toBe('https://localhost/old')
    await user.clear(field)
    await user.type(field, 'https://localhost/new{Enter}')
    expect(md(editor)).toBe('[site](https://localhost/new) after')
    expect(editor.state.selection.from).toBe(3)
  })

  test('on a link it removes the whole link', async () => {
    const user = userEvent.setup()
    const editor = setup(linkDoc())
    select(editor, 3, 3)
    await user.click(button('Link'))
    await user.click(await screen.findByRole('button', { name: 'Remove link' }))
    expect(md(editor)).toBe('site after')
  })

  test('an address that cannot open is refused and nothing changes', async () => {
    const user = userEvent.setup()
    const editor = setup()
    select(editor, 1, 6)
    await user.click(button('Link'))
    await user.type(await address(), 'javascript:alert(1){Enter}')
    await screen.findByText('Enter a web or mailto address')
    expect(md(editor)).toBe('Hello world')
  })

  test('Escape closes the window and changes nothing', async () => {
    const user = userEvent.setup()
    const editor = setup()
    select(editor, 1, 6)
    await user.click(button('Link'))
    await user.type(await address(), 'example.com')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Link address' })).toBeNull())
    expect(md(editor)).toBe('Hello world')
  })
})

test('every button names itself, with no keys in its name', () => {
  setup()
  for (const name of ['Text style', 'Bold', 'Italic', 'Bulleted list', 'Numbered list', 'Checkbox', 'Quote', 'Link']) button(name)
  expect(button('Bold').getAttribute('aria-keyshortcuts')).toBeNull()
})

describe('what is around the block changed', () => {
  type Block = Record<string, unknown>
  const item = (...content: Block[]) => ({ type: 'listItem', content })
  const bullets = (...content: Block[]) => ({ type: 'bulletList', content })
  const tasks = (...items: [string, boolean][]) => ({ type: 'taskList', content: items.map(([text, checked]) => ({ type: 'taskItem', attrs: { checked }, content: [p(text)] })) })
  const quote = (...content: Block[]) => ({ type: 'blockquote', content })
  const nested = () => doc(bullets(item(p('Parent'), list('Alpha', 'Beta', 'Gamma')), item(p('Next'))))
  const cursorIn = (editor: Editor, text: string) => act(() => {
    let at = -1
    editor.state.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text === text) at = pos + 1
    })
    editor.commands.setTextSelection(at)
  })
  const selectAll = (editor: Editor) => act(() => { editor.commands.selectAll() })

  test.each([
    ['Checkbox', '- Parent\n  - Alpha\n  - [ ] Beta\n  - Gamma\n- Next'],
    ['Numbered list', '- Parent\n  - Alpha\n  1. Beta\n  - Gamma\n- Next'],
    ['Bulleted list', '- Parent\n  - Alpha\n  Beta\n  - Gamma\n- Next'],
  ])('%s on a nested item leaves the others nested, one Undo takes it back', (name, marked) => {
    const editor = setup(nested())
    cursorIn(editor, 'Beta')
    act(() => { press(name) })
    expect(md(editor)).toBe(marked)
    act(() => { editor.commands.undo() })
    expect(md(editor)).toBe('- Parent\n  - Alpha\n  - Beta\n  - Gamma\n- Next')
  })

  test('a nested item taken off is not lit, and a second press puts it back', () => {
    const editor = setup(nested())
    cursorIn(editor, 'Beta')
    act(() => { press('Bulleted list') })
    expect(pressed('Bulleted list')).toBe('false')
    act(() => { press('Bulleted list') })
    expect(md(editor)).toBe('- Parent\n  - Alpha\n  - Beta\n  - Gamma\n- Next')
  })

  test.each([
    ['Checkbox', '- [ ] Parent\n  - Alpha\n  - Beta\n  - Gamma\n\n- Next'],
    ['Bulleted list', 'Parent\n\n- Alpha\n- Beta\n- Gamma\n\n- Next'],
  ])('%s works on an item with items of its own', (name, marked) => {
    const editor = setup(nested())
    cursorIn(editor, 'Parent')
    act(() => { press(name) })
    expect(md(editor)).toBe(marked)
  })

  test('only the kind of list of the item itself is lit', () => {
    const editor = setup(doc({ type: 'orderedList', content: [item(p('Outer'), list('Inner'))] }))
    cursorIn(editor, 'Inner')
    expect([pressed('Bulleted list'), pressed('Numbered list')]).toEqual(['true', 'false'])
  })

  test.each([
    ['Numbered list', '> - One\n>\n> 1. Two\n>\n> - Three'],
    ['Bulleted list', '> - One\n>\n> Two\n>\n> - Three'],
    ['Quote', '> - One\n\n- Two\n\n> - Three'],
  ])('%s on an item in a quote changes only that item', (name, marked) => {
    const editor = setup(doc(quote(list('One', 'Two', 'Three'))))
    cursorIn(editor, 'Two')
    act(() => { press(name) })
    expect(md(editor)).toBe(marked)
  })

  test('a paragraph in a quote becomes a list there', () => {
    const editor = setup(doc(quote(p('First'), p('Second'), p('Third'))))
    cursorIn(editor, 'Second')
    act(() => { press('Bulleted list') })
    expect(md(editor)).toBe('> First\n>\n> - Second\n>\n> Third')
  })

  test('Checkbox keeps the ticks of what is a checkbox already', () => {
    const editor = setup(doc(tasks(['Done', true]), p('Plain')))
    selectAll(editor)
    act(() => { press('Checkbox') })
    expect(md(editor)).toBe('- [x] Done\n- [ ] Plain')
  })

  test('Checkbox keeps the ticks next to items of another list', () => {
    const editor = setup(doc(tasks(['Done', true], ['Open', false]), list('More')))
    selectAll(editor)
    act(() => { press('Checkbox') })
    expect(md(editor)).toBe('- [x] Done\n- [ ] Open\n- [ ] More')
  })

  // The note ends on an empty paragraph after a list, which a selection of all takes in.
  test('all of a checklist is lit, so a press takes it off, with no item added', () => {
    const editor = setup(doc(tasks(['Done', true], ['Open', false]), { type: 'paragraph' }))
    selectAll(editor)
    expect(pressed('Checkbox')).toBe('true')
    act(() => { press('Checkbox') })
    expect(md(editor)).toBe('Done\n\nOpen')
    act(() => { editor.commands.undo() })
    expect(md(editor)).toBe('- [x] Done\n- [ ] Open')
  })

  test('all of a nested list changes its type and keeps its levels', () => {
    const editor = setup(nested())
    selectAll(editor)
    act(() => { press('Numbered list') })
    expect(md(editor)).toBe('1. Parent\n   1. Alpha\n   2. Beta\n   3. Gamma\n2. Next')
  })

  test('all of a quote is lit and comes off, not quoted twice', () => {
    const editor = setup(doc(quote(p('One'), p('Two')), { type: 'paragraph' }))
    selectAll(editor)
    expect(pressed('Quote')).toBe('true')
    act(() => { press('Quote') })
    expect(md(editor)).toBe('One\n\nTwo')
  })

  test('a quote in the quote taken off keeps its own', () => {
    const editor = setup(doc(quote(p('One'), quote(p('Inner')), p('Two'))))
    selectAll(editor)
    act(() => { press('Quote') })
    expect(md(editor)).toBe('One\n\n> Inner\n\nTwo')
  })

  test('Quote over a quote and a paragraph makes one quote', () => {
    const editor = setup(doc(quote(p('One')), p('Two')))
    selectAll(editor)
    act(() => { press('Quote') })
    expect(md(editor)).toBe('> One\n>\n> Two')
  })

  test('Quote takes a whole list selected', () => {
    const editor = setup(doc(list('One', 'Two')))
    selectAll(editor)
    act(() => { press('Quote') })
    expect(md(editor)).toBe('> - One\n> - Two')
  })
})

describe('a click that leaves the link window or the menu', () => {
  const inside = { Link: () => screen.findByRole('textbox', { name: 'Link address' }), 'Text style': () => screen.findByRole('menuitemradio', { name: 'Heading 1' }) }
  const closed = () => new Promise(resolve => setTimeout(resolve, 50))

  async function opened(name: keyof typeof inside) {
    const user = userEvent.setup()
    const editor = setup()
    act(() => { editor.commands.focus(3) })
    await waitFor(() => expect(editor.isFocused).toBe(true))
    await user.click(button(name))
    await inside[name]()
    return { user, editor }
  }

  test.each(['Link', 'Text style'] as const)('%s: a field clicked keeps the focus', async name => {
    const { user, editor } = await opened(name)
    const field = document.body.appendChild(document.createElement('input'))
    try {
      await user.click(field)
      await act(closed)
      expect(document.activeElement).toBe(field)
      expect(editor.isFocused).toBe(false)
    } finally {
      field.remove()
    }
  })

  test.each(['Link', 'Text style'] as const)('%s: after a click on plain text, what is typed is not in the note', async name => {
    const { user, editor } = await opened(name)
    await user.click(document.body)
    await act(closed)
    expect(editor.isFocused).toBe(false)
  })

  test.each([['Link', 'Text style'], ['Text style', 'Link']] as const)('%s gives way to %s, which stays', async (from, to) => {
    const { user, editor } = await opened(from)
    await user.click(button(to))
    await inside[to]()
    await act(closed)
    expect(await inside[to]()).toBeTruthy()
    expect(editor.isFocused).toBe(false)
  })

  test.each(['Link', 'Text style'] as const)('%s: Escape gives the focus back to the note', async name => {
    const { user, editor } = await opened(name)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(editor.isFocused).toBe(true))
  })
})

describe('the selection of the note', () => {
  const kept = (editor: Editor) => editor.view.dom.querySelector('[class*="keptSelection"]')?.textContent ?? null

  test.each([['Link', 'textbox', 'Link address'], ['Text style', 'menuitemradio', 'Heading 1']] as const)('stays visible while %s is open, and not after', async (opener, role, name) => {
    const user = userEvent.setup()
    const editor = setup()
    act(() => { editor.commands.focus() })
    await waitFor(() => expect(editor.isFocused).toBe(true))
    select(editor, 1, 6)
    await user.click(button(opener))
    await screen.findByRole(role, { name })
    await waitFor(() => expect(kept(editor)).toBe('Hello'))
    await user.click(document.body)
    await waitFor(() => expect(screen.queryByRole(role, { name })).toBeNull())
    await waitFor(() => expect(kept(editor)).toBeNull())
  })

  test('is not painted while the focus is just elsewhere', async () => {
    const editor = setup()
    act(() => { editor.commands.focus() })
    await waitFor(() => expect(editor.isFocused).toBe(true))
    select(editor, 1, 6)
    act(() => { editor.view.dom.blur() })
    await waitFor(() => expect(editor.isFocused).toBe(false))
    expect(kept(editor)).toBeNull()
  })
})
