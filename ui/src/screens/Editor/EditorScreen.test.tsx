import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { DESIGN_REVIEW_ID, QUEUE_JOB, queueSnapshot, SPEAKER_IDS, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { effectiveSpeaker } from '../../api/types'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { EVENT_SCRIPTS } from '../../api/fixtures/event-scripts'
import { useQueueEventsSync } from '../../api/queries'
import { createMockElectronAPI } from '../../platform/electron-api-mock'
import { OverlayProvider } from '../../OverlayProvider'
import { EditorScreen } from './EditorScreen'

afterEach(() => {
  dismissAllToasts()
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
    unobserve() {}
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

const shown = (label: string) => !screen.getByLabelText(label).hasAttribute('inert')
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

const sidebarRow = (name: RegExp) => within(screen.getByLabelText('Recordings')).getByRole('button', { name })
const newDot = (name: RegExp) => within(sidebarRow(name)).queryByRole('img', { name: 'New' })

describe('the dot of a new recording', () => {
  test('shows on a recording not opened yet, not on one with an unnamed speaker', async () => {
    // Not Design review: open at startup, it would lose its dot as soon as it loads.
    setup({ initialSelectedId: WEEKLY_SYNC_ID })
    await screen.findByRole('region', { name: 'This week' })
    expect(newDot(/Design review/)).toBeTruthy()
    expect(newDot(/Weekly product sync/)).toBeNull()
    expect(within(sidebarRow(/Weekly product sync/)).getByText('?')).toBeTruthy()
    expect(newDot(/Call with Mark/)).toBeNull()
  })

  test('goes once the recording has loaded, and stays gone', async () => {
    const client = createFixtureClient()
    const opened = vi.spyOn(client, 'markTranscriptOpened')
    render(
      <ApiProvider client={client}>
        <OverlayProvider><EditorScreen /></OverlayProvider>
      </ApiProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: /Design review/ }))
    await waitFor(() => expect(newDot(/Design review/)).toBeNull())
    expect(opened).toHaveBeenCalledWith(DESIGN_REVIEW_ID)
    expect((await client.listTranscripts()).find(t => t.id === DESIGN_REVIEW_ID)?.opened).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: /Call with Mark/ }))
    await userEvent.click(screen.getByRole('button', { name: /Design review/ }))
    expect(newDot(/Design review/)).toBeNull()
    expect(opened).toHaveBeenCalledTimes(1)
  })

  test('stays on a recording that fails to load', async () => {
    const markTranscriptOpened = vi.fn(() => Promise.resolve())
    setup({ initialSelectedId: DESIGN_REVIEW_ID }, {
      overrides: { getTranscript: () => Promise.reject(new ApiError(500, 'Server error 500')), markTranscriptOpened },
    })
    expect(await screen.findByText('Could not load this recording')).toBeTruthy()
    expect(newDot(/Design review/)).toBeTruthy()
    expect(markTranscriptOpened).not.toHaveBeenCalled()
  })

  test('a mark that fails shows nothing and is not asked again', async () => {
    const markTranscriptOpened = vi.fn(() => Promise.reject(new ApiError(500, 'Server error 500')))
    setup({ initialSelectedId: DESIGN_REVIEW_ID }, { overrides: { markTranscriptOpened } })
    await screen.findByRole('main', { name: 'Transcript' })
    await waitFor(() => expect(markTranscriptOpened).toHaveBeenCalledTimes(1))
    // The list comes back from the fixtures still not opened.
    await waitFor(() => expect(newDot(/Design review/)).toBeTruthy())
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(markTranscriptOpened).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('speakers across the panels', () => {
  const unknownInRow = () => within(sidebarRow(/Weekly product sync/)).queryByText('?')

  test('the unknown avatar goes when the last voice has a name, and Undo brings it back', async () => {
    setup({ initialSelectedId: WEEKLY_SYNC_ID })
    const inspector = within(await screen.findByRole('region', { name: 'Inspector' }))
    await userEvent.click(await inspector.findByRole('button', { name: /Mark Ellis.*\d+%/ }))
    await userEvent.click(inspector.getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(unknownInRow()).toBeNull())
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(unknownInRow()).toBeTruthy())
    expect(await inspector.findByText('1 of 1')).toBeTruthy()
  })

  test('Show all speakers on a turn: a new speaker, then Undo removes them', async () => {
    const client = createFixtureClient()
    render(
      <ApiProvider client={client}>
        <OverlayProvider><EditorScreen initialSelectedId={WEEKLY_SYNC_ID} /></OverlayProvider>
      </ApiProvider>,
    )
    const transcript = within(await screen.findByRole('main', { name: 'Transcript' }))
    await userEvent.click((await transcript.findAllByRole('button', { name: 'Mark Ellis' }))[0])
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Change speaker' })).getByText('Show all speakers'))
    const search = await screen.findByRole('searchbox')
    await userEvent.type(search, 'Olivia Brown')
    await userEvent.click(await screen.findByRole('button', { name: /Olivia Brown/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Create and assign' }))
    expect(await screen.findByText('Assigned to Olivia Brown')).toBeTruthy()
    const created = (await client.listSpeakers()).find(s => s.name === 'Olivia Brown')!
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    expect(segments.filter(s => effectiveSpeaker(s) === created.id).map(s => s.start)).toEqual([5, 8])

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(async () => expect((await client.listSpeakers()).some(s => s.id === created.id)).toBe(false))
    const after = (await client.getTranscript(WEEKLY_SYNC_ID)).segments
    expect(after.filter(s => [5, 8].includes(s.start)).map(effectiveSpeaker)).toEqual([SPEAKER_IDS.mark, SPEAKER_IDS.mark])
  })

  test('Undo still works after another recording was opened', async () => {
    setup({ initialSelectedId: WEEKLY_SYNC_ID })
    const inspector = within(await screen.findByRole('region', { name: 'Inspector' }))
    await userEvent.click(await inspector.findByRole('button', { name: /Mark Ellis.*\d+%/ }))
    await userEvent.click(inspector.getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(unknownInRow()).toBeNull())
    const undo = await screen.findByRole('button', { name: 'Undo' })
    await userEvent.click(screen.getByRole('button', { name: /Call with Mark/ }))
    await userEvent.click(undo)
    await waitFor(() => expect(unknownInRow()).toBeTruthy())
  })
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

describe('focus on the inspector buttons', () => {
  // jsdom does not work out :focus-visible: here every focus counts as from the keyboard.
  const fromKeyboard = () => {
    const matches = Element.prototype.matches
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' || matches.call(this, selector)
    })
  }

  test('from the keyboard it goes to the button that brings the inspector back', async () => {
    atWidth(1200)
    setup()
    fromKeyboard()
    await screen.findByRole('region', { name: 'This week' })
    screen.getByRole('button', { name: 'Close inspector' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(shown('Inspector')).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show inspector' }))
    await userEvent.keyboard('{Enter}')
    expect(shown('Inspector')).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close inspector' }))
  })

  test('it waits for the opening panel, which takes no focus on the first frame of its move', async () => {
    atWidth(1200)
    setup()
    fromKeyboard()
    await screen.findByRole('region', { name: 'This week' })
    screen.getByRole('button', { name: 'Close inspector' }).focus()
    await userEvent.keyboard('{Enter}')
    // As visibility: hidden does, the first try on Close inspector is refused.
    const focus = HTMLElement.prototype.focus
    let refused = false
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (!refused && this.getAttribute('aria-label') === 'Close inspector') { refused = true; return }
      focus.call(this, options)
    })
    await userEvent.keyboard('{Enter}')
    expect(refused).toBe(true)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close inspector' })))
  })

  test('a click leaves focus alone', async () => {
    atWidth(1200)
    setup()
    await screen.findByRole('region', { name: 'This week' })
    await userEvent.click(screen.getByRole('button', { name: 'Close inspector' }))
    expect(shown('Inspector')).toBe(false)
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Show inspector' }))
  })
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
    expect(within(dialog).getByText(`Delete "${title}"?`)).toBeTruthy()
    const body = within(dialog).getByText(/cannot be undone/)
    expect(body.querySelector('br')).toBeTruthy()
    expect(dialog.querySelectorAll('[data-modal-header] svg')).toHaveLength(1)
  })

  test('Cancel leaves everything as it was', async () => {
    await open()
    const dialog = await askToDelete()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(within(panel()).getByRole('heading', { level: 1 })).toBeTruthy()
  })

  test('Delete opens the recording opened before, takes it off the list and says so', async () => {
    await open()
    await userEvent.click(sidebarRow(/Design review/))
    await waitFor(() => expect(within(panel()).getByRole('heading', { level: 1 }).textContent).toBe('Design review'))
    const dialog = await askToDelete()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    // Not the newest one left, which is Interview: onboarding feedback.
    await waitFor(() => expect(within(panel()).getByRole('heading', { level: 1 }).textContent).toBe('Weekly product sync'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(within(screen.getByLabelText('Recordings')).queryByText('Design review')).toBeNull()
    expect(await screen.findByText('Deleted "Design review".')).toBeTruthy()
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

describe('the menu of a recording in the sidebar', () => {
  const menuOf = async (name: RegExp) => {
    fireEvent.contextMenu(await waitFor(() => sidebarRow(name)))
    return screen.findByRole('menu')
  }
  const choose = async (name: RegExp, item: string) => userEvent.click(within(await menuOf(name)).getByRole('menuitem', { name: item }))
  const panelTitle = () => within(screen.getByRole('main', { name: 'Transcript' })).getByRole('heading', { level: 1 }).textContent
  const open = async (options: FixtureOptions = {}) => {
    atWidth(1200)
    setup({ initialSelectedId: WEEKLY_SYNC_ID }, options)
    await screen.findByRole('heading', { level: 1 })
  }

  test('has Rename, Mark as unread, Pin and Delete recording, and a right click opens nothing', async () => {
    await open()
    const menu = await menuOf(/Call with Mark/)
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent!.trim())).toEqual(['Rename', 'Mark as unread', 'Pin', 'Delete recording'])
    expect(within(menu).getByRole('separator')).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Pin' }).getAttribute('aria-disabled')).toBe('true')
    expect(panelTitle()).toBe('Weekly product sync')
  })

  test('a recording not opened yet offers Mark as read, which takes the dot away', async () => {
    const client = createFixtureClient()
    const opened = vi.spyOn(client, 'markTranscriptOpened')
    atWidth(1200)
    render(<ApiProvider client={client}><OverlayProvider><EditorScreen initialSelectedId={WEEKLY_SYNC_ID} /></OverlayProvider></ApiProvider>)
    await screen.findByRole('heading', { level: 1 })
    await choose(/Design review/, 'Mark as read')
    await waitFor(() => expect(newDot(/Design review/)).toBeNull())
    expect(opened).toHaveBeenCalledWith(DESIGN_REVIEW_ID)
    expect(panelTitle()).toBe('Weekly product sync')
  })

  test('Mark as unread brings the dot back, also on the open recording until it opens again', async () => {
    const client = createFixtureClient()
    const unopened = vi.spyOn(client, 'markTranscriptUnopened')
    atWidth(1200)
    render(<ApiProvider client={client}><OverlayProvider><EditorScreen initialSelectedId={WEEKLY_SYNC_ID} /></OverlayProvider></ApiProvider>)
    await screen.findByRole('heading', { level: 1 })
    await choose(/Weekly product sync/, 'Mark as unread')
    await waitFor(() => expect(newDot(/Weekly product sync/)).toBeTruthy())
    expect(unopened).toHaveBeenCalledWith(WEEKLY_SYNC_ID)
    // The list is read again and the open recording is not marked opened by itself.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(newDot(/Weekly product sync/)).toBeTruthy()
    await userEvent.click(sidebarRow(/Call with Mark/))
    await userEvent.click(sidebarRow(/Weekly product sync/))
    await waitFor(() => expect(newDot(/Weekly product sync/)).toBeNull())
  })

  test('a failed mark puts the dot back as it was and says so', async () => {
    await open({ overrides: { markTranscriptUnopened: () => Promise.reject(new ApiError(500, 'Server error 500')) } })
    await choose(/Call with Mark/, 'Mark as unread')
    expect(await screen.findByText('Could not mark as unread: Server error 500')).toBeTruthy()
    expect(newDot(/Call with Mark/)).toBeNull()
  })

  test('Rename puts a field in the row; Enter saves, and the open recording shows the new title', async () => {
    await open()
    await choose(/Weekly product sync/, 'Rename')
    const field = await screen.findByRole('textbox', { name: 'Recording title' })
    await waitFor(() => expect(document.activeElement).toBe(field))
    await userEvent.keyboard('  Weekly sync  {Enter}')
    await waitFor(() => expect(sidebarRow(/^Weekly sync/)).toBeTruthy())
    expect(screen.queryByRole('textbox', { name: 'Recording title' })).toBeNull()
    await waitFor(() => expect(panelTitle()).toBe('Weekly sync'))
  })

  test('Rename of another recording leaves the open one; Escape and a blank title change nothing', async () => {
    const updateTranscriptTitle = vi.fn(() => Promise.resolve())
    await open({ overrides: { updateTranscriptTitle } })
    await choose(/Call with Mark/, 'Rename')
    await screen.findByRole('textbox', { name: 'Recording title' })
    await userEvent.keyboard('Other{Escape}')
    await choose(/Call with Mark/, 'Rename')
    await screen.findByRole('textbox', { name: 'Recording title' })
    await userEvent.keyboard('{Backspace}   {Enter}')
    expect(updateTranscriptTitle).not.toHaveBeenCalled()
    expect(sidebarRow(/Call with Mark/)).toBeTruthy()
    expect(panelTitle()).toBe('Weekly product sync')
  })

  test('a failed rename says so and the title goes back', async () => {
    await open({ overrides: { updateTranscriptTitle: () => Promise.reject(new ApiError(500, 'Server error 500')) } })
    await choose(/Call with Mark/, 'Rename')
    await screen.findByRole('textbox', { name: 'Recording title' })
    await userEvent.keyboard('Renamed{Enter}')
    expect(await screen.findByText('Failed to rename: Server error 500')).toBeTruthy()
    await waitFor(() => expect(sidebarRow(/Call with Mark/)).toBeTruthy())
  })

  // Only Weekly product sync and Design review have details in the fixtures.
  test('Delete recording of another recording asks first and leaves the open one', async () => {
    await open()
    await choose(/Design review/, 'Delete recording')
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Delete "Design review"?')).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(within(screen.getByLabelText('Recordings')).queryByText('Design review')).toBeNull())
    expect(panelTitle()).toBe('Weekly product sync')
  })

  test('Delete recording of the open one opens the one opened before', async () => {
    await open()
    await userEvent.click(sidebarRow(/Design review/))
    await waitFor(() => expect(panelTitle()).toBe('Design review'))
    await choose(/Design review/, 'Delete recording')
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(panelTitle()).toBe('Weekly product sync'))
  })
})

// Delete all data in Settings, or a deletion in another window: the list comes back
// without the open recording.
describe('the open recording gone from the list', () => {
  function setupWithQueries(initialSelectedId: number) {
    atWidth(1200)
    const client = createFixtureClient()
    let queries: QueryClient | null = null
    function Grab() {
      queries = useQueryClient()
      return null
    }
    render(
      <ApiProvider client={client}>
        <OverlayProvider><Grab /><EditorScreen initialSelectedId={initialSelectedId} /></OverlayProvider>
      </ApiProvider>,
    )
    // As Delete all data does: everything under transcripts, the open one too.
    const refresh = () => act(async () => { await queries!.invalidateQueries({ queryKey: ['transcripts'] }) })
    return { client, queries: () => queries!, refresh }
  }
  const panel = () => screen.getByRole('main', { name: 'Transcript' })
  const player = () => screen.getByRole('region', { name: 'Player' })

  test('after Delete all data nothing of it is shown and its data leaves the cache', async () => {
    const { client, queries, refresh } = setupWithQueries(WEEKLY_SYNC_ID)
    await within(panel()).findByRole('heading', { level: 1 })
    const speakersTab = () => within(screen.getByRole('region', { name: 'Inspector' })).getByRole('tabpanel')
    await waitFor(() => expect(speakersTab().textContent).not.toBe(''))
    await client.resetData()
    await refresh()
    await waitFor(() => expect(within(panel()).queryByRole('heading', { level: 1 })).toBeNull())
    expect(speakersTab().textContent).toBe('')
    expect(within(player()).getByRole('button', { name: 'Play' }).hasAttribute('disabled')).toBe(true)
    expect(queries().getQueryCache().findAll({ queryKey: ['transcripts', WEEKLY_SYNC_ID] })).toHaveLength(0)
    expect(queries().getQueryCache().findAll({ queryKey: ['waveform', WEEKLY_SYNC_ID] })).toHaveLength(0)
  })

  test('with recordings left, the one opened last of them opens', async () => {
    const { client, refresh } = setupWithQueries(WEEKLY_SYNC_ID)
    await within(panel()).findByRole('heading', { level: 1 })
    await userEvent.click(sidebarRow(/Design review/))
    await waitFor(() => expect(within(panel()).getByRole('heading', { level: 1 }).textContent).toBe('Design review'))
    await client.deleteTranscript(DESIGN_REVIEW_ID)
    await refresh()
    await waitFor(() => expect(within(panel()).getByRole('heading', { level: 1 }).textContent).toBe('Weekly product sync'))
  })
})

// What rebuilding the old editor took care of by hand: nothing here is rebuilt.
describe('a refresh in the background', () => {
  const JOB_DONE = { ...EVENT_SCRIPTS.transcribing, steps: EVENT_SCRIPTS.transcribing.steps.filter(step => step.event.type === 'job_done').map(step => ({ ...step, afterMs: 0 })) }

  function Synced(props: { initialSelectedId: number }) {
    useQueueEventsSync()
    return <EditorScreen {...props} />
  }

  const open = async () => {
    atWidth(1200)
    const made: HTMLAudioElement[] = []
    const RealAudio = Audio
    vi.stubGlobal('Audio', function FakeAudio() {
      const audio = new RealAudio()
      made.push(audio)
      return audio
    })
    const client = createFixtureClient()
    render(<ApiProvider client={client}><OverlayProvider><Synced initialSelectedId={WEEKLY_SYNC_ID} /></OverlayProvider></ApiProvider>)
    const heading = await screen.findByRole('heading', { level: 1 })
    const review = await screen.findByRole('region', { name: 'Review speakers' })
    const scroll = document.querySelector<HTMLElement>('[data-transcript-scroll]')!
    const row = screen.getAllByRole('button', { name: /^Go to / })[0]
    scroll.scrollTop = 840
    return { client, made, heading, review, scroll, row }
  }

  const expectUntouched = ({ heading, review, scroll, row }: Awaited<ReturnType<typeof open>>) => {
    expect(heading.isConnected).toBe(true)
    expect(review.isConnected).toBe(true)
    expect(row.isConnected).toBe(true)
    expect(scroll.isConnected).toBe(true)
    expect(scroll.scrollTop).toBe(840)
  }

  test('a job done elsewhere keeps the transcript, its scroll, the review and the audio', async () => {
    const view = await open()
    const main = view.made[0]
    const source = vi.spyOn(main, 'src', 'set')
    const load = vi.spyOn(main, 'load')
    const before = screen.getAllByRole('region').length
    await act(async () => { view.client.playEvents(JOB_DONE) })
    await waitFor(() => expect(within(screen.getByLabelText('Recordings')).getByText('Planning call')).toBeTruthy())
    expectUntouched(view)
    expect(source).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
    expect(screen.getAllByRole('region').length).toBe(before)
  })

  test('a refresh that fails keeps what is on the screen', async () => {
    const view = await open()
    const failure = new ApiError(0, 'Failed to fetch')
    for (const method of ['listTranscripts', 'getTranscript', 'listSpeakers', 'getSpeakerCandidates'] as const) {
      vi.spyOn(view.client, method).mockRejectedValue(failure)
    }
    await act(async () => { view.client.playEvents(JOB_DONE) })
    await waitFor(() => expect(view.client.getTranscript).toHaveBeenCalled())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expectUntouched(view)
    expect(screen.queryByText('Could not load this recording')).toBeNull()
    expect(screen.queryByText('Could not load recordings')).toBeNull()
    expect(screen.queryByText('Could not load the speakers')).toBeNull()
  })
})

describe('moving the panels', () => {
  const panels = () => screen.getByLabelText('Inspector').parentElement!

  test('the button moves them, a resized window does not', async () => {
    const resize = atWidth(1200)
    setup()
    await waitFor(() => expect(shown('Inspector')).toBe(true))
    const moved: boolean[] = []
    const watch = new MutationObserver(() => moved.push(panels().hasAttribute('data-moving')))
    watch.observe(panels(), { attributes: true, attributeFilter: ['data-moving'] })
    resize(1111)
    resize(1200)
    await waitFor(() => expect(shown('Inspector')).toBe(true))
    expect(moved).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    await waitFor(() => expect(moved).toEqual([true, false]))
    watch.disconnect()
  })

  test('a closed panel keeps its column and cannot be reached', async () => {
    atWidth(1200)
    setup()
    await waitFor(() => expect(shown('Inspector')).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(panels().className).toContain('noSidebar')
    expect(screen.getByLabelText('Recordings').hasAttribute('inert')).toBe(true)
    expect(screen.queryByRole('complementary', { name: 'Recordings' })).toBeNull()
  })

  test('with reduced motion nothing moves', async () => {
    const matchMedia = vi.fn(() => ({ matches: true }))
    vi.stubGlobal('matchMedia', matchMedia)
    atWidth(1200)
    setup()
    await waitFor(() => expect(shown('Inspector')).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(panels().hasAttribute('data-moving')).toBe(false)
    vi.unstubAllGlobals()
  })
})


describe('the recording open at startup', () => {
  const heading = () => within(screen.getByRole('main', { name: 'Transcript' })).findByRole('heading', { level: 1 })
  const withRecent = async (recentTranscriptIds: number[]) => {
    const bridge = createMockElectronAPI()
    await bridge.writeSettings({ ...await bridge.readSettings(), recentTranscriptIds })
    vi.stubGlobal('electronAPI', bridge)
    return bridge
  }

  test('is the newest one when none was opened before', async () => {
    setup()
    expect((await heading()).textContent).toBe('Design review')
  })

  test('is the one opened last', async () => {
    await withRecent([WEEKLY_SYNC_ID, DESIGN_REVIEW_ID])
    setup()
    expect((await heading()).textContent).toBe('Weekly product sync')
  })

  test('is the one opened before it when the last one is gone', async () => {
    await withRecent([404, WEEKLY_SYNC_ID, DESIGN_REVIEW_ID])
    setup()
    expect((await heading()).textContent).toBe('Weekly product sync')
  })

  test('the one opened goes first in the settings, and the rest stay', async () => {
    const bridge = await withRecent([WEEKLY_SYNC_ID])
    setup()
    await heading()
    await userEvent.click(sidebarRow(/Design review/))
    await waitFor(async () => expect((await bridge.readSettings()).recentTranscriptIds).toEqual([DESIGN_REVIEW_ID, WEEKLY_SYNC_ID]))
    expect((await bridge.readSettings()).scale).toBe(100)
  })

  test('is none without recordings', async () => {
    await withRecent([WEEKLY_SYNC_ID])
    setup({}, { scenario: 'empty' })
    await screen.findByText('No recordings yet')
    expect(within(screen.getByRole('main', { name: 'Transcript' })).queryByRole('heading', { level: 1 })).toBeNull()
  })
})

describe('closing the open recording with Escape', () => {
  const panel = () => screen.getByRole('main', { name: 'Transcript' })
  const title = () => within(panel()).queryByRole('heading', { level: 1 })?.textContent ?? null
  const emptyShown = () => within(panel()).queryByText(/To make a new transcription/) !== null
  const play = () => within(screen.getByRole('region', { name: 'Player' })).getByRole('button', { name: 'Play' })
  const open = async (options: FixtureOptions = {}) => {
    atWidth(1200)
    const view = setup({ initialSelectedId: WEEKLY_SYNC_ID }, options)
    await within(panel()).findByRole('heading', { level: 1 })
    return view
  }
  const escape = () => userEvent.keyboard('{Escape}')

  test('leaves the empty state, with no row current and the inspector and player empty', async () => {
    await open()
    expect(sidebarRow(/Weekly product sync/).getAttribute('aria-current')).toBe('true')
    await escape()
    await waitFor(() => expect(emptyShown()).toBe(true))
    expect(title()).toBeNull()
    expect(sidebarRow(/Weekly product sync/).getAttribute('aria-current')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Inspector' })).getByRole('tabpanel').textContent).toBe('')
    expect(play().hasAttribute('disabled')).toBe(true)
  })

  test('with a modifier it closes nothing', async () => {
    await open()
    await userEvent.keyboard('{Shift>}{Escape}{/Shift}{Control>}{Escape}{/Control}')
    expect(title()).toBe('Weekly product sync')
  })

  test('closes from a sidebar row reached from the keyboard, which keeps the focus', async () => {
    await open()
    sidebarRow(/Call with Mark/).focus()
    await escape()
    await waitFor(() => expect(emptyShown()).toBe(true))
    expect(document.activeElement).toBe(sidebarRow(/Call with Mark/))
  })

  // Chromium shows the focus ring on any key, so the row clicked to open the
  // recording would light up as Escape closes it.
  test('the row clicked to open the recording lets go of the focus', async () => {
    await open()
    await userEvent.click(sidebarRow(/Design review/))
    await waitFor(() => expect(title()).toBe('Design review'))
    expect(document.activeElement).toBe(sidebarRow(/Design review/))
    await escape()
    await waitFor(() => expect(emptyShown()).toBe(true))
    expect(document.activeElement).toBe(document.body)
  })

  test('an open menu takes the first Escape, and the next one closes', async () => {
    await open()
    await userEvent.click((await screen.findAllByRole('button', { name: 'More' }))[0])
    await screen.findByRole('menu')
    await escape()
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(title()).toBe('Weekly product sync')
    await escape()
    await waitFor(() => expect(emptyShown()).toBe(true))
  })

  test('an open dialog takes Escape and the recording stays', async () => {
    await open()
    await userEvent.click((await screen.findAllByRole('button', { name: 'More' }))[0])
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete recording' }))
    await screen.findByRole('alertdialog')
    await escape()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(title()).toBe('Weekly product sync')
  })

  test('Escape in the rename field takes back the rename and the recording stays', async () => {
    const updateTranscriptTitle = vi.fn(() => Promise.resolve())
    await open({ overrides: { updateTranscriptTitle } })
    fireEvent.contextMenu(sidebarRow(/Call with Mark/))
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Rename' }))
    const field = await screen.findByRole('textbox', { name: 'Recording title' })
    await waitFor(() => expect(document.activeElement).toBe(field))
    await userEvent.keyboard('Other')
    await escape()
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Recording title' })).toBeNull())
    expect(updateTranscriptTitle).not.toHaveBeenCalled()
    expect(title()).toBe('Weekly product sync')
  })

  test('with nothing open, nothing opens by itself: not on a refresh, not after a delete', async () => {
    atWidth(1200)
    const client = createFixtureClient()
    let queries: QueryClient | null = null
    function Grab() {
      queries = useQueryClient()
      return null
    }
    render(<ApiProvider client={client}><OverlayProvider><Grab /><EditorScreen initialSelectedId={WEEKLY_SYNC_ID} /></OverlayProvider></ApiProvider>)
    await within(panel()).findByRole('heading', { level: 1 })
    await escape()
    await waitFor(() => expect(emptyShown()).toBe(true))
    await client.deleteTranscript(DESIGN_REVIEW_ID)
    await act(async () => { await queries!.invalidateQueries({ queryKey: ['transcripts'] }) })
    await waitFor(() => expect(within(screen.getByLabelText('Recordings')).queryByText('Design review')).toBeNull())
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(emptyShown()).toBe(true)
    expect(title()).toBeNull()
  })

  test('a click opens a recording again, and Escape closes it again', async () => {
    await open()
    await escape()
    await waitFor(() => expect(emptyShown()).toBe(true))
    await userEvent.click(sidebarRow(/Design review/))
    await waitFor(() => expect(title()).toBe('Design review'))
    expect(emptyShown()).toBe(false)
    await escape()
    await waitFor(() => expect(emptyShown()).toBe(true))
  })

  test('the recent ones stay as they were, so the next start opens the closed one', async () => {
    const bridge = createMockElectronAPI()
    await bridge.writeSettings({ ...await bridge.readSettings(), recentTranscriptIds: [WEEKLY_SYNC_ID, DESIGN_REVIEW_ID] })
    vi.stubGlobal('electronAPI', bridge)
    atWidth(1200)
    const view = setup()
    await waitFor(() => expect(title()).toBe('Weekly product sync'))
    await escape()
    await waitFor(() => expect(emptyShown()).toBe(true))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect((await bridge.readSettings()).recentTranscriptIds).toEqual([WEEKLY_SYNC_ID, DESIGN_REVIEW_ID])
    view.unmount()
    setup()
    await waitFor(() => expect(title()).toBe('Weekly product sync'))
  })

  test('a job of the queue in the centre closes too, and the recording under it with it', async () => {
    atWidth(1200)
    const client = createFixtureClient()
    client.playEvents({ steps: [{ afterMs: 0, event: queueSnapshot({ jobs: [{ ...QUEUE_JOB, id: 'q', title: 'Queued call' }] }) }] })
    await vi.waitFor(async () => expect((await client.getQueue()).jobs).toHaveLength(1))
    function Synced() {
      useQueueEventsSync()
      return <EditorScreen initialSelectedId={WEEKLY_SYNC_ID} />
    }
    render(<ApiProvider client={client}><OverlayProvider><Synced /></OverlayProvider></ApiProvider>)
    await within(panel()).findByRole('heading', { level: 1 })
    const queue = await screen.findByRole('region', { name: 'Transcription queue' })
    await userEvent.click(within(queue).getByRole('button', { name: /Queued call$/ }))
    await waitFor(() => expect(within(queue).getByRole('button', { name: /Queued call$/ }).getAttribute('aria-current')).toBe('true'))
    await escape()
    await waitFor(() => expect(emptyShown()).toBe(true))
    expect(within(queue).getByRole('button', { name: /Queued call$/ }).getAttribute('aria-current')).toBeNull()
    expect(title()).toBeNull()
  })
})
