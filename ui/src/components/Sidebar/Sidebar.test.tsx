import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { MenuAction } from '../Menu/Menu'
import { Sidebar, type SidebarRecording, type SidebarSection } from './Sidebar'

const recording = (id: number, title: string) => ({ id, title, speakers: [], isNew: false })
const SECTIONS: SidebarSection[] = [
  { title: 'This week', recordings: [recording(1, 'Design review'), recording(2, 'Call with Mark')] },
  { title: 'Earlier', recordings: [recording(3, 'Quarterly numbers')] },
]

test('shows the sections in order with their recordings', () => {
  render(<Sidebar sections={SECTIONS} />)
  const [week, earlier] = screen.getAllByRole('region')
  expect(within(week).getByText('This week')).toBeTruthy()
  expect(within(week).getAllByRole('button')).toHaveLength(2)
  expect(within(earlier).getByRole('button', { name: /Quarterly numbers/ })).toBeTruthy()
})

test('a click selects the recording', async () => {
  const onSelect = vi.fn()
  render(<Sidebar sections={SECTIONS} onSelect={onSelect} />)
  await userEvent.click(screen.getByRole('button', { name: /Call with Mark/ }))
  expect(onSelect).toHaveBeenCalledWith(2)
})

test('marks the selected recording only', () => {
  render(<Sidebar sections={SECTIONS} selectedId={3} />)
  const current = screen.getAllByRole('button').filter(b => b.getAttribute('aria-current'))
  expect(current.map(b => b.textContent)).toEqual(['Quarterly numbers'])
})

test('loading shows nothing at all', () => {
  render(<Sidebar state="loading" />)
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByText('No recordings yet')).toBeNull()
})

test('an empty list says so', () => {
  render(<Sidebar />)
  expect(screen.getByText('No recordings yet')).toBeTruthy()
})

test('an error offers a retry', async () => {
  const onRetry = vi.fn()
  render(<Sidebar state="error" onRetry={onRetry} />)
  expect(screen.getByText('Could not load recordings')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(onRetry).toHaveBeenCalledOnce()
})

test('shows what it is given above the list; nothing given takes no room', () => {
  const { container, rerender } = render(<Sidebar sections={SECTIONS} top={<p>Queue here</p>} />)
  const slot = screen.getByText('Queue here').parentElement!
  expect(slot.compareDocumentPosition(screen.getByText('This week')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const Nothing = () => null
  rerender(<Sidebar sections={SECTIONS} top={<Nothing />} />)
  expect(container.querySelector(':scope > div > div:empty')).not.toBeNull()
})

// ── Menu of a row ─────────────────────────────────────────────────────────────

const rowMenu = (onRename: (id: number) => void = vi.fn()) => (recording: SidebarRecording) => (
  <MenuAction onSelect={() => onRename(recording.id)}>{`Rename ${recording.title}`}</MenuAction>
)
const row = (name: string) => screen.getByRole('button', { name: new RegExp(name) })

test('the contextmenu event of a row opens its menu and does not select it', () => {
  const onSelect = vi.fn()
  render(<OverlayProvider><Sidebar sections={SECTIONS} onSelect={onSelect} rowMenu={rowMenu()} /></OverlayProvider>)
  fireEvent.contextMenu(row('Call with Mark'))
  expect(screen.getByRole('menuitem', { name: 'Rename Call with Mark' })).toBeTruthy()
  expect(onSelect).not.toHaveBeenCalled()
})

test('the row of an open menu looks as under the pointer until it closes', async () => {
  render(<OverlayProvider><Sidebar sections={SECTIONS} rowMenu={rowMenu()} /></OverlayProvider>)
  fireEvent.contextMenu(row('Call with Mark'))
  expect(row('Call with Mark').className).toMatch(/menuOpen/)
  expect(row('Design review').className).not.toMatch(/menuOpen/)
  await userEvent.keyboard('{Escape}')
  expect(row('Call with Mark').className).not.toMatch(/menuOpen/)
})

test('without a menu the contextmenu event opens nothing', () => {
  render(<OverlayProvider><Sidebar sections={SECTIONS} /></OverlayProvider>)
  fireEvent.contextMenu(row('Call with Mark'))
  expect(screen.queryByRole('menu')).toBeNull()
})

test('the recording being renamed shows a field and reports what was typed', async () => {
  const onRenameDone = vi.fn()
  render(<Sidebar sections={SECTIONS} renamingId={2} onRenameDone={onRenameDone} />)
  const field = screen.getByRole('textbox', { name: 'Recording title' }) as HTMLInputElement
  expect(field.value).toBe('Call with Mark')
  await userEvent.keyboard('Call with Anna{Enter}')
  expect(onRenameDone).toHaveBeenCalledExactlyOnceWith(2, 'Call with Anna')
})

test('Rename from the menu leaves the focus in the field', async () => {
  const Harness = () => {
    const [renamingId, setRenamingId] = useState<number | null>(null)
    return (
      <OverlayProvider>
        <Sidebar sections={SECTIONS} rowMenu={rowMenu(setRenamingId)} renamingId={renamingId} onRenameDone={() => setRenamingId(null)} />
      </OverlayProvider>
    )
  }
  render(<Harness />)
  row('Call with Mark').focus()
  fireEvent.contextMenu(row('Call with Mark'))
  await userEvent.keyboard('{ArrowDown}{Enter}')
  await act(() => new Promise(resolve => requestAnimationFrame(resolve)))
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Recording title' }))
  // Done, the focus goes back to the row.
  await userEvent.keyboard('{Escape}')
  await act(() => new Promise(resolve => requestAnimationFrame(resolve)))
  expect(document.activeElement).toBe(row('Call with Mark'))
})

test('a menu opened from the keyboard gives the focus back to its row', async () => {
  render(<OverlayProvider><Sidebar sections={SECTIONS} rowMenu={rowMenu()} /></OverlayProvider>)
  row('Call with Mark').focus()
  fireEvent.contextMenu(row('Call with Mark'))
  await userEvent.keyboard('{Escape}')
  expect(document.activeElement).toBe(row('Call with Mark'))
  fireEvent.contextMenu(row('Call with Mark'))
  await userEvent.keyboard('{ArrowDown}{Enter}')
  expect(document.activeElement).toBe(row('Call with Mark'))
})
