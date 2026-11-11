import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { TitleField } from './TitleField'

const setup = () => {
  const onDone = vi.fn()
  render(<TitleField title="Weekly sync" label="Recording title" onDone={onDone} />)
  return { onDone, field: screen.getByRole('textbox', { name: 'Recording title' }) as HTMLInputElement }
}

test('starts with the title, focused and selected', () => {
  const { field } = setup()
  expect(field.value).toBe('Weekly sync')
  expect(document.activeElement).toBe(field)
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'Weekly sync'.length])
})

test('Enter gives what was typed, once', async () => {
  const { onDone } = setup()
  await userEvent.keyboard('Renamed{Enter}')
  expect(onDone).toHaveBeenCalledExactlyOnceWith('Renamed')
})

test('leaving the field gives what was typed', async () => {
  const { onDone, field } = setup()
  await userEvent.keyboard('Renamed')
  fireEvent.blur(field)
  expect(onDone).toHaveBeenCalledExactlyOnceWith('Renamed')
})

test('Escape gives nothing, and the blur after it does not finish again', async () => {
  const { onDone, field } = setup()
  await userEvent.keyboard('Renamed{Escape}')
  fireEvent.blur(field)
  expect(onDone).toHaveBeenCalledExactlyOnceWith(null)
})
