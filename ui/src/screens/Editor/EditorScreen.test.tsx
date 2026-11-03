import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { SPEAKER_IDS, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { effectiveSpeaker } from '../../api/types'
import { dismissAllToasts } from '../../components/Toast/toast'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { EVENT_SCRIPTS } from '../../api/fixtures/event-scripts'
import { useQueueEventsSync } from '../../api/queries'
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

test('a recording with an unnamed speaker has the dot', async () => {
  setup()
  const row = await screen.findByRole('button', { name: /Weekly product sync/ })
  expect(within(row).getByRole('img', { name: 'Needs review' })).toBeTruthy()
  const named = screen.getByRole('button', { name: /Call with Mark/ })
  expect(within(named).queryByRole('img', { name: 'Needs review' })).toBeNull()
})

describe('speakers across the panels', () => {
  const dot = () => within(within(screen.getByLabelText('Recordings')).getByRole('button', { name: /Weekly product sync/ })).queryByRole('img', { name: 'Needs review' })

  test('the dot goes when the last voice has a name, and Undo brings it back', async () => {
    setup({ initialSelectedId: WEEKLY_SYNC_ID })
    const inspector = within(await screen.findByRole('region', { name: 'Inspector' }))
    await userEvent.click(await inspector.findByRole('button', { name: /Mark Ellis.*\d+%/ }))
    await userEvent.click(inspector.getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(dot()).toBeNull())
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(dot()).toBeTruthy())
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
    await waitFor(() => expect(dot()).toBeNull())
    const undo = await screen.findByRole('button', { name: 'Undo' })
    await userEvent.click(screen.getByRole('button', { name: /Call with Mark/ }))
    await userEvent.click(undo)
    await waitFor(() => expect(dot()).toBeTruthy())
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

  test('Delete closes the recording, takes it off the list and says so', async () => {
    await open()
    const title = screen.getByRole('heading', { level: 1 }).textContent!
    const dialog = await askToDelete()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(within(panel()).queryByRole('heading', { level: 1 })).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(within(screen.getByLabelText('Recordings')).queryByText(title)).toBeNull()
    expect(await screen.findByText(`Deleted "${title}".`)).toBeTruthy()
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

