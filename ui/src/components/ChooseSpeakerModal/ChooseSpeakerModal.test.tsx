import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { dismissAllToasts } from '../Toast/toast'
import { ChooseSpeakerModal, type ChooseSpeakerCategory, type ChooseSpeakerRow } from './ChooseSpeakerModal'

afterEach(dismissAllToasts)

const BEST: ChooseSpeakerRow[] = [
  { id: 'mark', name: 'Mark Ellis', colorIndex: 0, score: 0.82, suggested: true },
  { id: 'lena', name: 'Lena Kovacs', colorIndex: 3, score: 0.41 },
]
const OTHERS: ChooseSpeakerRow[] = [{ id: 'anna', name: 'Anna Petrova', colorIndex: 4, usage: '8 recordings' }]

const list = (query: string, category: ChooseSpeakerCategory) => {
  const match = (row: ChooseSpeakerRow) => row.name.toLowerCase().includes(query.trim().toLowerCase())
  const best = BEST.filter(match)
  const others = OTHERS.filter(match)
  return {
    counts: { all: best.length + others.length, best: best.length, recording: 0 },
    sections: [
      { title: 'Best voice matches', rows: best },
      ...(category === 'all' ? [{ title: 'Other speakers', rows: others }] : []),
    ].filter(section => section.rows.length),
  }
}

function setup(props = {}) {
  const handlers = { onAssign: vi.fn(), onNewSpeaker: vi.fn(), onClose: vi.fn() }
  render(<OverlayProvider><ChooseSpeakerModal list={list} {...handlers} {...props} /></OverlayProvider>)
  return handlers
}

const assign = () => screen.getByRole('button', { name: 'Assign' }) as HTMLButtonElement
const field = () => screen.getByRole('searchbox', { name: 'Search speakers' })

test('starts in the search field, with the sections and the counts', () => {
  setup()
  expect(document.activeElement).toBe(field())
  expect(within(screen.getByRole('group', { name: 'Best voice matches' })).getByText('Mark Ellis')).toBeTruthy()
  expect(within(screen.getByRole('group', { name: 'Other speakers' })).getByText('Anna Petrova')).toBeTruthy()
  expect(within(screen.getByRole('button', { name: /All speakers/ })).getByText('3')).toBeTruthy()
})

test('what was preselected is selected, and Assign takes it', async () => {
  const { onAssign } = setup({ initialSelectedId: 'mark' })
  expect(screen.getByRole('option', { name: /Mark Ellis/ }).getAttribute('aria-selected')).toBe('true')
  await userEvent.click(assign())
  expect(onAssign).toHaveBeenCalledWith('mark')
})

test('Assign waits for a choice', async () => {
  const { onAssign } = setup()
  expect(assign().disabled).toBe(true)
  await userEvent.click(screen.getByRole('option', { name: /Anna Petrova/ }))
  expect(assign().disabled).toBe(false)
  await userEvent.click(assign())
  expect(onAssign).toHaveBeenCalledWith('anna')
})

test('a double click assigns', async () => {
  const { onAssign } = setup()
  await userEvent.dblClick(screen.getByRole('option', { name: /Lena Kovacs/ }))
  expect(onAssign).toHaveBeenCalledWith('lena')
})

test('a category narrows the list', async () => {
  setup()
  await userEvent.click(screen.getByRole('button', { name: /Best voice matches/ }))
  expect(screen.queryByText('Anna Petrova')).toBeNull()
  expect(screen.getByRole('button', { name: /Best voice matches/ }).getAttribute('aria-current')).toBe('true')
})

test.each(['Invited to this meeting', 'Recently added'])('%s is not there yet', async name => {
  setup()
  const item = screen.getByRole('button', { name })
  expect(item.getAttribute('aria-disabled')).toBe('true')
  await userEvent.click(item)
  expect(await screen.findByText('Not available yet')).toBeTruthy()
  expect(screen.getByRole('button', { name: /All speakers/ }).getAttribute('aria-current')).toBe('true')
})

test('arrows move the selection, Enter assigns', async () => {
  const { onAssign } = setup()
  await userEvent.keyboard('{ArrowDown}{ArrowDown}')
  expect(screen.getByRole('option', { name: /Lena Kovacs/ }).getAttribute('aria-selected')).toBe('true')
  await userEvent.keyboard('{ArrowUp}{Enter}')
  expect(onAssign).toHaveBeenCalledWith('mark')
})

test('typing narrows the list and takes the first result', async () => {
  const { onAssign } = setup()
  await userEvent.type(field(), 'anna')
  expect(screen.queryByText('Mark Ellis')).toBeNull()
  expect(screen.getByRole('option', { name: /Anna Petrova/ }).getAttribute('aria-selected')).toBe('true')
  await userEvent.keyboard('{Enter}')
  expect(onAssign).toHaveBeenCalledWith('anna')
})

test('no results: says so, offers a new speaker, and Assign is off', async () => {
  const { onNewSpeaker } = setup({ initialQuery: 'Zoe' })
  expect(screen.getByText('No speakers match “Zoe”')).toBeTruthy()
  expect(assign().disabled).toBe(true)
  expect(within(screen.getByRole('button', { name: /All speakers/ })).getByText('0')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Add “Zoe” as a new speaker' }))
  expect(onNewSpeaker).toHaveBeenCalledWith('Zoe')
})

test('no results: Enter offers the new speaker too', async () => {
  const { onNewSpeaker, onAssign } = setup({ initialQuery: 'Zoe' })
  await userEvent.keyboard('{Enter}')
  expect(onNewSpeaker).toHaveBeenCalledWith('Zoe')
  expect(onAssign).not.toHaveBeenCalled()
})

test('New speaker takes along what was typed', async () => {
  const { onNewSpeaker } = setup({ initialQuery: 'Mark' })
  await userEvent.click(screen.getByRole('button', { name: 'New speaker' }))
  expect(onNewSpeaker).toHaveBeenCalledWith('Mark')
})

test('Cancel and the cross close', async () => {
  const { onClose } = setup()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalledOnce()
})

test('a percentage and a count of recordings show on the right', () => {
  setup()
  expect(screen.getByText('82%')).toBeTruthy()
  expect(screen.getByText('8 recordings')).toBeTruthy()
})
