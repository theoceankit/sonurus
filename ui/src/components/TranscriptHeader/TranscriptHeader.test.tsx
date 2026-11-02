import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { TranscriptHeader } from './TranscriptHeader'

const setup = (props: Partial<Parameters<typeof TranscriptHeader>[0]> = {}) => {
  const onRename = vi.fn()
  render(<OverlayProvider><TranscriptHeader title="Weekly sync" date="4 Oct 2026, 02:33" language="English" onRename={onRename} {...props} /></OverlayProvider>)
  return onRename
}
const title = () => screen.getByRole('button', { name: 'Weekly sync' })
const field = () => screen.getByRole('textbox', { name: 'Transcript title' }) as HTMLInputElement

test('shows the title, the date and the language, and no folder', () => {
  setup()
  expect(screen.getByRole('heading', { name: 'Weekly sync' })).toBeTruthy()
  expect(screen.getByText('4 Oct 2026, 02:33')).toBeTruthy()
  expect(screen.getByText('English')).toBeTruthy()
  expect(screen.queryByText(/team/i)).toBeNull()
})

test('leaves out what it does not know', () => {
  setup({ language: undefined })
  expect(screen.queryByText('English')).toBeNull()
})

test.each([false, true])('sticky %s: Pin, Export and More are not available yet', sticky => {
  setup({ sticky })
  for (const name of ['Pin', 'Export', 'More']) {
    expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true')
  }
})

test('sticky: the title on one line, no date', () => {
  setup({ sticky: true })
  expect(screen.getByText('Weekly sync')).toBeTruthy()
  expect(screen.queryByText('4 Oct 2026, 02:33')).toBeNull()
})

test('a click on the title gives a field with the title selected', async () => {
  setup()
  await userEvent.click(title())
  expect(document.activeElement).toBe(field())
  expect(field().value).toBe('Weekly sync')
  expect([field().selectionStart, field().selectionEnd]).toEqual([0, 11])
})

test('Enter on the title gives the field too', async () => {
  setup()
  title().focus()
  await userEvent.keyboard('{Enter}')
  expect(field()).toBeTruthy()
})

test('Enter reports what was typed, once', async () => {
  const onRename = setup()
  await userEvent.click(title())
  await userEvent.keyboard('Renamed{Enter}')
  expect(onRename).toHaveBeenCalledExactlyOnceWith('Renamed')
  expect(screen.queryByRole('textbox')).toBeNull()
})

test('leaving the field reports too', async () => {
  const onRename = setup()
  await userEvent.click(title())
  await userEvent.keyboard('Renamed')
  await userEvent.click(document.body)
  expect(onRename).toHaveBeenCalledExactlyOnceWith('Renamed')
})

test('Esc changes nothing and does not report through the blur', async () => {
  const onRename = setup()
  await userEvent.click(title())
  await userEvent.keyboard('Renamed{Escape}')
  expect(onRename).not.toHaveBeenCalled()
  expect(title()).toBeTruthy()
})

test('the field stops at the longest title the API takes', async () => {
  setup()
  await userEvent.click(title())
  expect(field().maxLength).toBe(200)
})
