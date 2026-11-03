import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { Paragraph } from './Paragraph'

const TEXT = 'Retry for failed jobs works too.'

const setup = (props: Partial<Parameters<typeof Paragraph>[0]> = {}) => {
  const handlers = { onSave: vi.fn(), onCancel: vi.fn(), onEdit: vi.fn(), onPlay: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onChangeSpeaker: vi.fn() }
  render(<OverlayProvider><Paragraph text={TEXT} color={1} {...handlers} {...props} /></OverlayProvider>)
  return handlers
}

const bar = () => screen.queryByRole('toolbar', { name: 'Paragraph' })

test('shows the text and no bar until the pointer comes', async () => {
  setup()
  expect(screen.getByText(TEXT)).toBeTruthy()
  expect(bar()).toBeNull()
  await userEvent.hover(screen.getByText(TEXT))
  expect(bar()).toBeTruthy()
  await userEvent.unhover(screen.getByText(TEXT))
  expect(bar()).toBeNull()
})

test.each(['Play', 'Edit', 'Copy', 'More'])('%s names itself in a tooltip', async name => {
  setup({ showActions: true })
  await userEvent.hover(screen.getByRole('button', { name }))
  expect((await screen.findByRole('tooltip')).textContent).toContain(name)
})

test('the bar has Play, Edit, Copy and More', async () => {
  const { onPlay, onEdit, onCopy } = setup({ showActions: true })
  await userEvent.click(screen.getByRole('button', { name: 'Play' }))
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
  await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
  expect(onPlay).toHaveBeenCalledOnce()
  expect(onEdit).toHaveBeenCalledOnce()
  expect(onCopy).toHaveBeenCalledOnce()
})

test('More offers Change speaker, which says where to open, and Delete', async () => {
  const { onChangeSpeaker, onDelete } = setup({ showActions: true })
  const more = screen.getByRole('button', { name: 'More' })
  await userEvent.click(more)
  await userEvent.click(screen.getByRole('menuitem', { name: 'Change speaker' }))
  expect(onChangeSpeaker).toHaveBeenCalledWith(more)
  await userEvent.click(more)
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
  expect(onDelete).toHaveBeenCalledOnce()
})

test('the bar stays while its menu is open, even after the pointer left', async () => {
  setup()
  await userEvent.hover(screen.getByText(TEXT))
  await userEvent.click(screen.getByRole('button', { name: 'More' }))
  fireEvent.pointerLeave(screen.getByText(TEXT).parentElement!)
  expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy()
})

test('a double click on the text starts the edit', async () => {
  const { onEdit } = setup()
  await userEvent.dblClick(screen.getByText(TEXT))
  expect(onEdit).toHaveBeenCalledOnce()
})

test('playing draws the bar in the colour of the speaker', () => {
  setup({ playing: true, color: 4 })
  expect(screen.getByTestId('playing').getAttribute('style')).toContain('--color-speaker-4-mid')
})

const field = () => screen.getByRole('textbox', { name: 'Paragraph text' }) as HTMLTextAreaElement

test('editing: a focused field with the text and the caret at the end, no bar', () => {
  setup({ editing: true, showActions: true })
  expect(document.activeElement).toBe(field())
  expect(field().value).toBe(TEXT)
  expect(field().selectionStart).toBe(TEXT.length)
  expect(bar()).toBeNull()
})

test('Ctrl+Enter and Save save the trimmed text, once', async () => {
  const { onSave, onCancel } = setup({ editing: true })
  await userEvent.clear(field())
  await userEvent.type(field(), '  New text  {Control>}{Enter}{/Control}')
  expect(onSave).toHaveBeenCalledExactlyOnceWith('New text')
  field().blur()
  expect(onSave).toHaveBeenCalledOnce()
  expect(onCancel).not.toHaveBeenCalled()
})

test('Save saves and does not go through the blur first', async () => {
  const { onSave } = setup({ editing: true })
  await userEvent.type(field(), ' more')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledExactlyOnceWith(`${TEXT} more`)
})

test('Esc and Cancel throw the edit away', async () => {
  const { onSave, onCancel } = setup({ editing: true })
  await userEvent.type(field(), ' more{Escape}')
  expect(onSave).not.toHaveBeenCalled()
  expect(onCancel).toHaveBeenCalledOnce()
})

test('Cancel with the mouse does not save through the blur', async () => {
  const { onSave, onCancel } = setup({ editing: true })
  await userEvent.type(field(), ' more')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onSave).not.toHaveBeenCalled()
  expect(onCancel).toHaveBeenCalledOnce()
})

test('leaving the field saves', async () => {
  const { onSave } = setup({ editing: true })
  await userEvent.type(field(), ' more')
  await userEvent.click(document.body)
  expect(onSave).toHaveBeenCalledExactlyOnceWith(`${TEXT} more`)
})

test('Tab to the buttons stays in the edit', async () => {
  const { onSave, onCancel } = setup({ editing: true })
  await userEvent.tab()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  expect(onSave).not.toHaveBeenCalled()
  expect(onCancel).not.toHaveBeenCalled()
})

test.each([['empty', ''], ['blank', '   '], ['the same', TEXT]])('%s text saves nothing', async (_, typed) => {
  const { onSave, onCancel } = setup({ editing: true })
  await userEvent.clear(field())
  if (typed) await userEvent.type(field(), typed)
  await userEvent.keyboard('{Control>}{Enter}{/Control}')
  expect(onSave).not.toHaveBeenCalled()
  expect(onCancel).toHaveBeenCalledOnce()
})
