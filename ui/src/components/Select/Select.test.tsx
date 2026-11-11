import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { Modal } from '../Modal/Modal'
import { ModalBody } from '../ModalBody/ModalBody'
import { ModalHeader } from '../ModalHeader/ModalHeader'
import { Select, type SelectOption } from './Select'
import css from './Select.module.css?raw'

const OPTIONS: SelectOption[] = [
  { value: 'tiny', label: 'Whisper Tiny', meta: 'Not installed', disabled: true },
  { value: 'base', label: 'Whisper Base' },
  { value: 'small', label: 'Whisper Small' },
]

function Controlled({ onValueChange = () => {}, start = 'base' }: { onValueChange?: (value: string) => void; start?: string }) {
  const [value, setValue] = useState(start)
  return <Select label="Model" value={value} options={OPTIONS} onValueChange={next => { setValue(next); onValueChange(next) }} />
}

const field = () => screen.getByRole('combobox', { name: 'Model' })
const option = (name: RegExp) => screen.getByRole('option', { name })

test('the field shows the chosen option under its label', () => {
  render(<Controlled />)
  expect(field().textContent?.trim()).toBe('Whisper Base')
})

test('the field is a combobox named by its label, or by aria-label, as a native select', () => {
  const { rerender } = render(<Controlled />)
  expect(field().getAttribute('aria-expanded')).toBe('false')
  rerender(<Select aria-label="Theme" value="base" options={OPTIONS} onValueChange={() => {}} />)
  expect(screen.getByRole('combobox', { name: 'Theme' }).textContent?.trim()).toBe('Whisper Base')
})

test('the list is a listbox of options named by their labels', async () => {
  render(<Controlled />)
  const combobox = field()
  await userEvent.click(combobox)
  const list = screen.getByRole('listbox', { name: 'Model' })
  expect(screen.getAllByRole('option').map(row => row.textContent?.trim())).toEqual(['Whisper TinyNot installed', 'Whisper Base', 'Whisper Small'])
  expect(list.contains(option(/^Whisper Small$/))).toBe(true)
  // The rest of the window is hidden while the list is open, the field too.
  expect(combobox.getAttribute('aria-expanded')).toBe('true')
})

test('picking an option changes the value, marks it and closes the list', async () => {
  const onValueChange = vi.fn()
  render(<Controlled onValueChange={onValueChange} />)
  await userEvent.click(field())
  expect(option(/Whisper Base/).getAttribute('aria-selected')).toBe('true')
  expect(option(/Whisper Small/).getAttribute('aria-selected')).toBe('false')
  await userEvent.click(option(/Whisper Small/))
  expect(onValueChange).toHaveBeenCalledWith('small')
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(field().textContent?.trim()).toBe('Whisper Small')
})

test('a disabled option says why and cannot be picked', async () => {
  const onValueChange = vi.fn()
  render(<Controlled onValueChange={onValueChange} />)
  await userEvent.click(field())
  const tiny = option(/Whisper Tiny/)
  expect(tiny.textContent).toContain('Not installed')
  expect(tiny.getAttribute('aria-disabled')).toBe('true')
  await userEvent.click(tiny)
  expect(onValueChange).not.toHaveBeenCalled()
})

test('the keyboard opens the list on the chosen option and skips a disabled one', async () => {
  render(<Controlled start="small" />)
  field().focus()
  await userEvent.keyboard('{Enter}')
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{ArrowUp}{ArrowUp}')
  expect(document.activeElement?.textContent).toBe('Whisper Base')
  await userEvent.keyboard('{Escape}')
  expect(document.activeElement).toBe(field())
})

test('opened by the pointer, the list shows no focus ring on the chosen option; opened by the keyboard, it does', async () => {
  render(<Controlled />)
  field().focus()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByRole('listbox').dataset.input).toBeUndefined()
  await userEvent.keyboard('{Escape}')
  await userEvent.click(field())
  expect(screen.getByRole('listbox').dataset.input).toBe('pointer')
})

test('a value that is none of the options shows the placeholder', () => {
  render(<Select aria-label="Model" value="" placeholder="Checking models..." options={[]} onValueChange={() => {}} />)
  expect(field().textContent?.trim()).toBe('Checking models...')
})

test('disabled, it does not open', async () => {
  render(<Select label="Model" value="base" options={OPTIONS} disabled onValueChange={() => {}} />)
  expect(field()).toHaveProperty('disabled', true)
  await userEvent.click(field())
  expect(screen.queryByRole('listbox')).toBeNull()
})

test('inside a modal the list opens and picks as anywhere else', async () => {
  const onValueChange = vi.fn()
  render(
    <Modal open>
      <ModalHeader title="New transcription" />
      <ModalBody><Controlled onValueChange={onValueChange} /></ModalBody>
    </Modal>,
  )
  await userEvent.click(field())
  await userEvent.click(option(/Whisper Small/))
  expect(onValueChange).toHaveBeenCalledWith('small')
})

test('the list is as wide as the field and never taller than the room it has', () => {
  expect(css).toMatch(/\.list \{[^}]*width: var\(--radix-select-trigger-width\)/)
  expect(css).toMatch(/\.list \{[^}]*max-height: var\(--radix-select-content-available-height\)/)
  expect(css).toMatch(/\.list \{[^}]*overflow-y: auto/)
})
