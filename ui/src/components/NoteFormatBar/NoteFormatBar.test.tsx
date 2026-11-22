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

test('every button names itself, Bold and Italic with their keys', () => {
  setup()
  for (const name of ['Text style', 'Bold', 'Italic', 'Bulleted list', 'Numbered list', 'Checkbox', 'Quote', 'Link']) button(name)
  expect(button('Bold').getAttribute('aria-keyshortcuts')).toBe('Control+B')
  expect(button('Italic').getAttribute('aria-keyshortcuts')).toBe('Control+I')
})
