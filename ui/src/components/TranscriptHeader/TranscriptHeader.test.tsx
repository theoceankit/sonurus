import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { TranscriptHeader } from './TranscriptHeader'
import headerCss from './TranscriptHeader.module.css?raw'

const setup = (props: Partial<Parameters<typeof TranscriptHeader>[0]> = {}) => {
  const onRename = vi.fn()
  render(<OverlayProvider><TranscriptHeader title="Weekly sync" date="4 Oct 2026, 02:33" language="English" onRename={onRename} {...props} /></OverlayProvider>)
  return onRename
}
const title = () => screen.getByRole('button', { name: 'Weekly sync' })
const field = () => screen.getByRole('textbox', { name: 'Transcript title' }) as HTMLInputElement

test('shows the title, the date and the language', () => {
  setup()
  expect(screen.getByRole('heading', { name: 'Weekly sync' })).toBeTruthy()
  expect(screen.getByText('4 Oct 2026, 02:33')).toBeTruthy()
  expect(screen.getByText('English')).toBeTruthy()
})

test('the folder is there, and is not there yet', () => {
  setup()
  expect(screen.getByRole('button', { name: 'No folder' }).dataset.notImplemented).toBe('transcript.folder')
})

test('the title shows it can be pressed with a layer, and no tooltip', async () => {
  setup()
  await userEvent.hover(title())
  await new Promise(resolve => setTimeout(resolve, 500))
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(headerCss).toMatch(/\.titleButton \{\s*composes: reset stateLayer focusRing/)
})

test('leaves out what it does not know', () => {
  setup({ language: undefined })
  expect(screen.queryByText('English')).toBeNull()
})

test.each([false, true])('sticky %s: Pin and Export are not available yet', sticky => {
  setup({ sticky })
  for (const name of ['Pin', 'Export']) {
    expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true')
  }
})

test.each([false, true])('sticky %s: More offers to delete the recording', async sticky => {
  const onDelete = vi.fn()
  setup({ sticky, onDelete })
  await userEvent.click(screen.getByRole('button', { name: 'More' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete recording' }))
  expect(onDelete).toHaveBeenCalledOnce()
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

test.each([false, true])('sticky %s: Copy transcript sits between Pin and Export and copies', async sticky => {
  const onCopy = vi.fn()
  setup({ sticky, onCopy })
  const names = screen.getAllByRole('button').map(button => button.getAttribute('aria-label')).filter(Boolean)
  expect(names).toEqual(['Pin', 'Copy transcript', 'Export', 'More'])
  await userEvent.click(screen.getByRole('button', { name: 'Copy transcript' }))
  expect(onCopy).toHaveBeenCalledOnce()
})

test.each([false, true])('sticky %s: with nothing to copy, Copy transcript is there but disabled', sticky => {
  setup({ sticky })
  const copy = screen.getByRole('button', { name: 'Copy transcript' }) as HTMLButtonElement
  expect(copy.disabled).toBe(true)
  expect(copy.dataset.notImplemented).toBeUndefined()
})

test.each([false, true])('sticky %s: Pin, Copy transcript, Export and More name themselves in tooltips', async sticky => {
  setup({ sticky, onCopy: () => {} })
  for (const name of ['Pin', 'Copy transcript', 'Export', 'More']) {
    await userEvent.hover(screen.getByRole('button', { name }))
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toContain(name))
    await userEvent.unhover(screen.getByRole('button', { name }))
  }
})
