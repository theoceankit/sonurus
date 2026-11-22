import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { dismissAllToasts } from '../Toast/toast-store'
import { OverlayProvider } from '../../OverlayProvider'
import { NotesPanel } from '../NotesPanel/NotesPanel'
import { Inspector } from './Inspector'

afterEach(dismissAllToasts)

const panel = (props = {}) => render(<OverlayProvider><Inspector {...props}><p>content</p></Inspector></OverlayProvider>)

test('opens on Speakers, with its content', () => {
  panel()
  expect(screen.getByRole('tab', { name: 'Speakers' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByText('content')).toBeTruthy()
})

test('has two tabs, Speakers and Notes', () => {
  panel()
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Speakers', 'Notes'])
})

test('Notes opens and shows the note in place of the speakers', async () => {
  panel({ notes: <p>the note</p> })
  const tab = screen.getByRole('tab', { name: 'Notes' })
  expect(tab.getAttribute('aria-disabled')).toBeNull()
  await userEvent.click(tab)
  expect(tab.getAttribute('aria-selected')).toBe('true')
  expect(screen.getByText('the note')).toBeTruthy()
  expect(screen.queryByText('content')).toBeNull()
})

test('the button closes the panel', async () => {
  const onClose = vi.fn()
  panel({ onClose })
  await userEvent.click(screen.getByRole('button', { name: 'Close inspector' }))
  expect(onClose).toHaveBeenCalledOnce()
})

test('the button names itself in a tooltip, as the sidebar button does', async () => {
  panel()
  await userEvent.hover(screen.getByRole('button', { name: 'Close inspector' }))
  expect((await screen.findByRole('tooltip')).textContent).toContain('Close inspector')
})

test('review off: no dock', () => {
  panel()
  expect(screen.queryByRole('region', { name: 'Review speakers' })).toBeNull()
})

test('review on: the title, the counter and the card', () => {
  panel({ review: { mode: 'on', counter: '1 of 4', card: <p>card</p> } })
  expect(screen.getByRole('region', { name: 'Review speakers' })).toBeTruthy()
  expect(screen.getByText('1 of 4')).toBeTruthy()
  expect(screen.getByText('card')).toBeTruthy()
})

test('review collapsed: how many are left, and Resume', async () => {
  const onResume = vi.fn()
  panel({ review: { mode: 'collapsed', left: 4, onResume } })
  expect(screen.getByText('4 left')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
  expect(onResume).toHaveBeenCalledOnce()
})

// The note's buttons come into the row through a portal, next to Close inspector.
test('Copy notes, Expand notes and Close inspector share one tooltip', async () => {
  const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Agenda' }] }] }
  panel({ notes: <NotesPanel content={content} findSpeaker={() => null} /> })
  await userEvent.click(screen.getByRole('tab', { name: 'Notes' }))
  const button = (name: string) => screen.getByRole('button', { name })
  // As a browser does: out of one element into the next, then a move over it.
  const move = (from: Element, to: Element) => {
    fireEvent.pointerOut(from, { relatedTarget: to })
    fireEvent.pointerOver(to, { relatedTarget: from })
    fireEvent.pointerMove(to)
  }
  const waited = (ms: number) => act(async () => { vi.advanceTimersByTime(ms) })
  const shown = () => screen.queryAllByRole('tooltip').map(tooltip => tooltip.textContent)
  vi.useFakeTimers()
  try {
    fireEvent.pointerMove(button('Expand notes'))
    await waited(350)
    expect(shown()).toEqual(['Expand notes'])
    await waited(1000)
    const row = button('Expand notes').closest('[data-tooltip-group]')!
    expect(button('Close inspector').closest('[data-tooltip-group]')?.getAttribute('data-tooltip-group')).toBe(row.getAttribute('data-tooltip-group'))

    // Over the gap between them it stays, either way, and the next comes at once.
    move(button('Expand notes'), button('Close inspector').parentElement!)
    await waited(50)
    expect(shown()).toEqual(['Expand notes'])
    move(button('Close inspector').parentElement!, button('Close inspector'))
    await waited(0)
    expect(shown()).toEqual(['Close inspector'])
    move(button('Close inspector'), button('Copy notes'))
    await waited(0)
    expect(shown()).toEqual(['Copy notes'])
    move(button('Copy notes'), document.body)
    await waited(200)
    expect(shown()).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})
