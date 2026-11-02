import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { OverlayProvider } from '../../OverlayProvider'
import { EditorScreen } from './EditorScreen'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// jsdom has no layout: the observer reports the width the test asks for.
function atWidth(width: number) {
  const observers: (() => void)[] = []
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { observers.push(callback) }
    observe() {}
    disconnect() {}
  })
  return (next: number) => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => next)
    act(() => observers.forEach(notify => notify()))
  }
}

function setup(props = {}, options: FixtureOptions = {}) {
  return render(
    <ApiProvider client={createFixtureClient(options)}>
      <OverlayProvider><EditorScreen {...props} /></OverlayProvider>
    </ApiProvider>,
  )
}

const shown = (label: string) => !screen.getByLabelText(label).hidden
const sidebarShown = () => shown('Recordings')

test('groups the recordings of the fixtures without a pinned section', async () => {
  setup()
  await screen.findByRole('region', { name: 'This week' })
  expect(screen.queryByRole('region', { name: 'Pinned' })).toBeNull()
  expect(within(screen.getByRole('region', { name: 'This week' })).getAllByRole('button')).toHaveLength(5)
  expect(within(screen.getByRole('region', { name: 'Earlier' })).getAllByRole('button')).toHaveLength(11)
})

test('pinned recordings show when given', async () => {
  setup({ pinnedIds: [WEEKLY_SYNC_ID, 2] })
  const pinned = await screen.findByRole('region', { name: 'Pinned' })
  expect(within(pinned).getAllByRole('button').map(b => b.textContent)[0]).toMatch(/Weekly product sync/)
})

test('a recording with an unnamed speaker has the dot', async () => {
  setup()
  const row = await screen.findByRole('button', { name: /Weekly product sync/ })
  expect(within(row).getByRole('img', { name: 'Needs review' })).toBeTruthy()
  const named = screen.getByRole('button', { name: /Call with Mark/ })
  expect(within(named).queryByRole('img', { name: 'Needs review' })).toBeNull()
})

test('a click selects a recording', async () => {
  setup()
  const row = await screen.findByRole('button', { name: /Call with Mark/ })
  await userEvent.click(row)
  expect(row.getAttribute('aria-current')).toBe('true')
})

test('the list is empty while loading', () => {
  setup({}, { scenario: 'loading' })
  expect(screen.queryByText('No recordings yet')).toBeNull()
  expect(screen.queryByRole('region', { name: 'This week' })).toBeNull()
})

test('an empty list says so', async () => {
  setup({}, { scenario: 'empty' })
  expect(await screen.findByText('No recordings yet')).toBeTruthy()
})

test('Retry asks again after an error', async () => {
  const listTranscripts = vi.fn()
    .mockRejectedValueOnce(new Error('down'))
    .mockResolvedValue([])
  setup({}, { overrides: { listTranscripts } })
  await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('No recordings yet')).toBeTruthy()
  expect(listTranscripts).toHaveBeenCalledTimes(2)
})

test('a wide window shows both side panels', async () => {
  atWidth(1200)
  setup()
  await screen.findByRole('region', { name: 'This week' })
  expect(sidebarShown()).toBe(true)
  expect(shown('Inspector')).toBe(true)
  expect(screen.queryByRole('button', { name: 'Show inspector' })).toBeNull()
})

test('a narrow window hides the inspector, its button opens it instead of the sidebar', async () => {
  atWidth(900)
  setup()
  await userEvent.click(await screen.findByRole('button', { name: 'Show inspector' }))
  expect(shown('Inspector')).toBe(true)
  expect(sidebarShown()).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
  expect(sidebarShown()).toBe(true)
  expect(shown('Inspector')).toBe(false)
})

test('resizing the window changes what fits', async () => {
  const resize = atWidth(1200)
  setup()
  await waitFor(() => expect(shown('Inspector')).toBe(true))
  resize(1111)
  expect(shown('Inspector')).toBe(false)
  resize(1112)
  expect(shown('Inspector')).toBe(true)
})

test('Toggle sidebar closes and opens the sidebar', async () => {
  atWidth(1200)
  setup()
  const toggle = screen.getByRole('button', { name: 'Toggle sidebar' })
  await userEvent.click(toggle)
  expect(sidebarShown()).toBe(false)
  await userEvent.click(toggle)
  expect(sidebarShown()).toBe(true)
})

test('the panels show what they are given', () => {
  setup({ transcript: 'T', inspector: 'I', player: 'P' })
  expect(screen.getByRole('main', { name: 'Transcript' }).textContent).toBe('T')
  expect(screen.getByRole('region', { name: 'Player' }).textContent).toBe('P')
})

describe('deleting the open recording', () => {
  const askToDelete = async () => {
    await userEvent.click((await screen.findAllByRole('button', { name: 'More' }))[0])
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete recording' }))
    return screen.findByRole('alertdialog')
  }
  const open = async (options: FixtureOptions = {}) => {
    atWidth(1200)
    setup({ initialSelectedId: WEEKLY_SYNC_ID }, options)
    await screen.findByRole('heading', { level: 1 })
  }
  const panel = () => screen.getByRole('main', { name: 'Transcript' })

  test('asks first, with the name of the recording', async () => {
    await open()
    const title = screen.getByRole('heading', { level: 1 }).textContent!
    const dialog = await askToDelete()
    expect(within(dialog).getByText(`Delete “${title}”?`)).toBeTruthy()
    expect(within(dialog).getByText(/cannot be undone/)).toBeTruthy()
  })

  test('Cancel leaves everything as it was', async () => {
    await open()
    const dialog = await askToDelete()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(within(panel()).getByRole('heading', { level: 1 })).toBeTruthy()
  })

  test('Delete closes the recording, takes it off the list and says so', async () => {
    await open()
    const title = screen.getByRole('heading', { level: 1 }).textContent!
    const dialog = await askToDelete()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(within(panel()).queryByRole('heading', { level: 1 })).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(within(screen.getByLabelText('Recordings')).queryByText(title)).toBeNull()
    expect(await screen.findByText(`Deleted “${title}”.`)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('a failure says so and the recording stays open', async () => {
    await open({ overrides: { deleteTranscript: () => Promise.reject(new ApiError(500, 'Server error 500')) } })
    const dialog = await askToDelete()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Could not delete: Server error 500')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(within(panel()).getByRole('heading', { level: 1 })).toBeTruthy()
  })
})
