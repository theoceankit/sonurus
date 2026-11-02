import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { SpeakerMenu, type SpeakerMenuRow } from './SpeakerMenu'

const ROWS: SpeakerMenuRow[] = [
  { id: 'mark', name: 'Mark Ellis', colorIndex: 0, current: true, time: '0:20' },
  { id: 'anna', name: 'Anna Petrova', colorIndex: 4, current: false, time: '0:19' },
  { id: 'lena', name: 'Lena Kovacs', colorIndex: 3, current: false, usage: '1 transcript, 0:40' },
]

// Closing gives the focus back to the anchor a moment later: that must not land in the next test.
beforeEach(() => new Promise(resolve => setTimeout(resolve)))

const setup = () => {
  const handlers = { onSelect: vi.fn(), onClose: vi.fn(), onShowAll: vi.fn() }
  const anchor = document.body.appendChild(document.createElement('button'))
  render(
    <OverlayProvider>
      <SpeakerMenu
        anchor={anchor}
        allSpeakers={13}
        rows={query => ({ section: query ? null : 'In this recording', rows: ROWS.filter(row => row.name.toLowerCase().includes(query.toLowerCase())) })}
        {...handlers}
      />
    </OverlayProvider>,
  )
  return { ...handlers, anchor }
}

const search = () => screen.getByRole('searchbox', { name: 'Search speakers' })

test('search has the focus, the section and rows are there, and Show all with its count', () => {
  setup()
  expect(document.activeElement).toBe(search())
  expect(screen.getByText('In this recording')).toBeTruthy()
  expect(screen.getAllByRole('option').map(row => row.textContent)).toEqual(['MEMark Ellis0:20', 'APAnna Petrova0:19', 'LKLena Kovacs1 transcript, 0:40'])
  expect(screen.getByRole('button', { name: /Show all speakers/ }).textContent).toContain('13')
})

test('the current speaker is the selected option', () => {
  setup()
  expect(screen.getByRole('option', { selected: true }).textContent).toContain('Mark Ellis')
})

test('a click on another speaker selects them', async () => {
  const { onSelect, onClose } = setup()
  await userEvent.click(screen.getByText('Anna Petrova'))
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('anna')
  expect(onClose).not.toHaveBeenCalled()
})

test('a click on the current speaker only closes', async () => {
  const { onSelect, onClose } = setup()
  await userEvent.click(screen.getByText('Mark Ellis'))
  expect(onSelect).not.toHaveBeenCalled()
  expect(onClose).toHaveBeenCalledOnce()
})

test('typing filters and drops the section; nothing found says so', async () => {
  setup()
  await userEvent.keyboard('an')
  expect(screen.queryByText('In this recording')).toBeNull()
  expect(screen.getAllByRole('option')).toHaveLength(1)
  await userEvent.keyboard('zz')
  expect(screen.getByText('No speakers match “anzz”')).toBeTruthy()
})

test('arrows move the highlight, focus stays in the search, Enter chooses', async () => {
  const { onSelect } = setup()
  await userEvent.keyboard('{ArrowDown}')
  expect(search().getAttribute('aria-activedescendant')).toBe('speaker-menu-anna')
  expect(document.activeElement).toBe(search())
  await userEvent.keyboard('{Enter}')
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('anna')
})

test('arrows reach Show all speakers and stop at the ends', async () => {
  const { onShowAll } = setup()
  await userEvent.keyboard('{ArrowUp}')
  expect(search().getAttribute('aria-activedescendant')).toBe('speaker-menu-mark')
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}')
  expect(search().getAttribute('aria-activedescendant')).toBeNull()
  await userEvent.keyboard('{Enter}')
  expect(onShowAll).toHaveBeenCalledOnce()
})

test('the first Esc clears a filled search, the next closes', async () => {
  const { onClose } = setup()
  await userEvent.keyboard('an{Escape}')
  expect((search() as HTMLInputElement).value).toBe('')
  expect(onClose).not.toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledOnce()
})

test('a recording with no named speakers says that rather than a failed search', () => {
  const anchor = document.body.appendChild(document.createElement('button'))
  render(<OverlayProvider><SpeakerMenu anchor={anchor} allSpeakers={0} rows={() => ({ section: null, rows: [] })} onSelect={vi.fn()} onClose={vi.fn()} /></OverlayProvider>)
  expect(screen.getByText('No speakers with a name here yet')).toBeTruthy()
})
