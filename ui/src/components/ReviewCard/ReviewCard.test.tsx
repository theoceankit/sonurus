import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ReviewCard } from './ReviewCard'
import reviewCardCss from './ReviewCard.module.css?raw'
import inspectorCss from '../Inspector/Inspector.module.css?raw'

const UNKNOWN = { kind: 'unknown', name: 'Unknown speaker 1' } as const
const CANDIDATES = [
  { id: 'mark', name: 'Mark Ellis', colorIndex: 0, score: 0.82, suggested: true },
  { id: 'lena', name: 'Lena Kovacs', colorIndex: 3, score: 0.41, suggested: false },
]
const CLIP = { duration: '0:04', text: 'That was me.', progress: 0 }

const card = (props = {}) => render(<ReviewCard speaker={UNKNOWN} clip={CLIP} candidates={CANDIDATES} {...props} />)

test('shows the speaker, the candidates and Add a new speaker', () => {
  card()
  expect(screen.getByText('Unknown speaker 1')).toBeTruthy()
  expect(screen.getByRole('button', { name: /Mark Ellis/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Add a new speaker' })).toBeTruthy()
})

test('Assign waits for a choice', () => {
  const { rerender } = card()
  expect((screen.getByRole('button', { name: 'Assign' }) as HTMLButtonElement).disabled).toBe(true)
  rerender(<ReviewCard speaker={UNKNOWN} clip={CLIP} candidates={CANDIDATES} selectedId="lena" />)
  expect((screen.getByRole('button', { name: 'Assign' }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.getByRole('button', { name: /Lena Kovacs/ }).getAttribute('aria-pressed')).toBe('true')
})

test('every action calls back', async () => {
  const handlers = { onSelect: vi.fn(), onSearch: vi.fn(), onAddNew: vi.fn(), onSkip: vi.fn(), onAssign: vi.fn(), onClose: vi.fn() }
  card({ ...handlers, selectedId: 'mark' })
  await userEvent.click(screen.getByRole('button', { name: /Lena Kovacs/ }))
  expect(handlers.onSelect).toHaveBeenCalledWith('lena')
  await userEvent.click(screen.getByRole('button', { name: 'Search speakers' }))
  await userEvent.click(screen.getByRole('button', { name: 'Add a new speaker' }))
  await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
  await userEvent.click(screen.getByRole('button', { name: 'Assign' }))
  await userEvent.click(screen.getByRole('button', { name: 'Close review' }))
  for (const handler of [handlers.onSearch, handlers.onAddNew, handlers.onSkip, handlers.onAssign, handlers.onClose]) expect(handler).toHaveBeenCalledOnce()
})

test('the text of the clip opens with the chevron', async () => {
  card()
  expect(screen.queryByText('That was me.')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Show text' }))
  expect(screen.getByText('That was me.')).toBeTruthy()
})

test('no clip, no player, and the rest stays', () => {
  card({ clip: null })
  expect(screen.queryByRole('button', { name: 'Play clip' })).toBeNull()
  expect(screen.getByRole('button', { name: /Mark Ellis/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy()
})

test('no candidates: the search and Add a new speaker stay', () => {
  card({ candidates: [] })
  expect(screen.getByText('Select speaker')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Search speakers' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Add a new speaker' })).toBeTruthy()
})

test('possible match says so', () => {
  card({ speaker: { name: 'Oliver Grant', color: 3 }, possibleMatch: true })
  expect(screen.getByText('Possible match')).toBeTruthy()
})

test('in the inspector a long clip scrolls inside the card, so the buttons stay where they are', () => {
  expect(reviewCardCss).toMatch(/@container inspector-panel \(min-height: \d+px\) \{[\s\S]*\.clip \{[^}]*min-height: 0;[\s\S]*\.text \{[^}]*min-height: 0;/)
  expect(inspectorCss).toMatch(/\.panel \{[^}]*container: inspector-panel \/ size;/)
  expect(inspectorCss).toMatch(/@container inspector-panel \(min-height: \d+px\) \{\s*\.dockBox,\s*\.dockPart,\s*\.dock,\s*\.dockBody \{\s*flex: 0 1 auto;\s*min-height: 0;/)
})

test('a long clip keeps to a few lines, so the speakers above stay readable', () => {
  expect(reviewCardCss).toMatch(/\.text \{[^}]*max-height: var\(--size-review-clip-text\);[^}]*overflow-y: auto;/)
})
