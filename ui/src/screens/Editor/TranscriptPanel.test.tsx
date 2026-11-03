import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Profiler, useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { DESIGN_REVIEW_ID, SPEAKER_IDS, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { effectiveSpeaker } from '../../api/types'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { longSegments } from '../../api/fixtures/long-recording'
import { dismissAllToasts } from '../../components/Toast/toast'
import { createKeyStore, type KeyStore } from '../../media/active-segment'
import type { Playback, PlaybackState } from '../../media/playback'
import { OverlayProvider } from '../../OverlayProvider'
import { TranscriptPanel } from './TranscriptPanel'

const paragraphRenders = vi.hoisted(() => ({ count: 0 }))

vi.mock('../../components/Paragraph/Paragraph', async original => {
  const module = await original<typeof import('../../components/Paragraph/Paragraph')>()
  return {
    ...module,
    Paragraph: (props: Parameters<typeof module.Paragraph>[0]) => {
      paragraphRenders.count++
      return module.Paragraph(props)
    },
  }
})

function fakePlayback(initial: Partial<PlaybackState> = {}) {
  let state: PlaybackState = { currentTime: 0, duration: 53, paused: true, rate: 1, volume: 1, status: 'ready', ...initial }
  const listeners = new Set<() => void>()
  const change = (next: Partial<PlaybackState>) => {
    state = { ...state, ...next }
    listeners.forEach(listener => listener())
  }
  const playback = {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load: vi.fn(),
    reload: vi.fn(),
    toggle: vi.fn(() => change({ paused: !state.paused })),
    seek: vi.fn((seconds: number) => change({ currentTime: seconds })),
    setRate: vi.fn(),
    setVolume: vi.fn(),
  } satisfies Playback
  return { playback, change }
}

const setup = (
  options: FixtureOptions = {},
  id: number | null = WEEKLY_SYNC_ID,
  wrap: (panel: ReactNode) => ReactNode = panel => panel,
  highlight: KeyStore<string | null> = createKeyStore<string | null>(null),
) => {
  const client = createFixtureClient(options)
  const { playback, change } = fakePlayback()
  const onShowAllSpeakers = vi.fn()
  render(
    <ApiProvider client={client}>
      <OverlayProvider>{wrap(<TranscriptPanel transcriptId={id} playback={playback} highlight={highlight} onShowAllSpeakers={onShowAllSpeakers} />)}</OverlayProvider>
    </ApiProvider>,
  )
  return { client, playback, change, onShowAllSpeakers, highlight }
}

const text = (value: string) => screen.findByText(value)
const FIRST = "Okay, let's get started. The main topic today is the release we shipped on Friday."
const MARK_FIRST = 'Right. The queue work landed, and so far nobody has reported a crash.'
const MARK_SECOND = 'Retry for failed jobs works too, I checked it.'

// Closing a menu gives the focus back a moment later: that must not land in the next test.
beforeEach(() => new Promise(resolve => setTimeout(resolve)))
afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

describe('states', () => {
  test('no recording: an empty panel', () => {
    setup({}, null)
    expect(screen.queryByRole('heading')).toBeNull()
  })

  test('loading: an empty panel', () => {
    setup({ scenario: 'loading' })
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('failed: a message and Retry that asks again', async () => {
    const client = createFixtureClient()
    const get = vi.spyOn(client, 'getTranscript').mockRejectedValueOnce(new ApiError(500, 'No'))
    const { playback } = fakePlayback()
    render(<ApiProvider client={client}><OverlayProvider><TranscriptPanel transcriptId={WEEKLY_SYNC_ID} playback={playback} /></OverlayProvider></ApiProvider>)
    await text('Could not load this recording')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await text(FIRST)
    expect(get).toHaveBeenCalledTimes(2)
  })

  test('no segments: says so under the header', async () => {
    const client = createFixtureClient()
    const transcript = await client.getTranscript(WEEKLY_SYNC_ID)
    vi.spyOn(client, 'getTranscript').mockResolvedValue({ ...transcript, segments: [] })
    const { playback } = fakePlayback()
    render(<ApiProvider client={client}><OverlayProvider><TranscriptPanel transcriptId={WEEKLY_SYNC_ID} playback={playback} /></OverlayProvider></ApiProvider>)
    await text('No speech in this recording')
    expect(screen.getByRole('heading', { name: 'Weekly product sync' })).toBeTruthy()
  })
})

describe('content', () => {
  test('header as on the boards: the date comes from the list', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Weekly product sync' })
    await text('4 Oct 2026, 02:33')
    expect(screen.getByText('English')).toBeTruthy()
  })

  test('neighbouring segments of one speaker are one turn', async () => {
    setup()
    await text(FIRST)
    expect(screen.getAllByRole('button', { name: 'Mark Ellis' })).toHaveLength(2)
    const first = screen.getAllByRole('button', { name: 'Mark Ellis' })[0].closest('[class*="turn"]')!.parentElement!
    expect(within(first).getByText(MARK_FIRST)).toBeTruthy()
    expect(within(first).getByText(MARK_SECOND)).toBeTruthy()
  })

  test('an unknown speaker is numbered, and is an ordinary turn', async () => {
    setup()
    await screen.findByRole('button', { name: 'Unknown speaker 1' })
    await userEvent.click(screen.getByRole('button', { name: 'Unknown speaker 1' }))
    expect(screen.getByRole('dialog', { name: 'Change speaker' })).toBeTruthy()
  })

  test('Unassigned segments show as such and open the menu too', async () => {
    setup({ board: 'unassigned' })
    await userEvent.click(await screen.findByRole('button', { name: 'Unassigned' }))
    expect(screen.getByRole('dialog', { name: 'Change speaker' })).toBeTruthy()
  })
})

describe('playing', () => {
  test('nothing marked until the audio has moved', async () => {
    setup()
    await text(FIRST)
    expect(screen.queryByTestId('playing')).toBeNull()
  })

  test('marks the paragraph of the time, moves on, and none in a pause', async () => {
    const { change } = setup()
    await text(MARK_SECOND)
    act(() => change({ currentTime: 9 }))
    expect(screen.getByTestId('playing').parentElement!.textContent).toContain(MARK_SECOND)
    act(() => change({ currentTime: 26 }))
    expect(screen.queryByTestId('playing')).toBeNull()
  })

  test('a click on the time of a turn seeks without playing', async () => {
    const { playback } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Go to 00:05' }))
    expect(playback.seek).toHaveBeenCalledExactlyOnceWith(5)
    expect(playback.toggle).not.toHaveBeenCalled()
  })

  test('Play on a paragraph seeks and plays', async () => {
    const { playback } = setup()
    await userEvent.hover(await text(MARK_SECOND))
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(playback.seek).toHaveBeenCalledExactlyOnceWith(8)
    expect(playback.toggle).toHaveBeenCalledOnce()
  })

  test('Play on a paragraph while playing only seeks', async () => {
    const { playback, change } = setup()
    act(() => change({ paused: false }))
    await userEvent.hover(await text(MARK_SECOND))
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(playback.toggle).not.toHaveBeenCalled()
  })
})

describe('a long recording', () => {
  const longOptions: FixtureOptions = { board: 'longRecording' }
  const LONG_ID = 1000

  test('has about 3000 segments over 3 hours, the same on every run', () => {
    const segments = longSegments()
    expect(segments.length).toBeGreaterThan(3000)
    expect(segments.at(-1)!.end).toBeGreaterThan(3 * 60 * 60)
    expect(longSegments()[100]).toEqual(segments[100])
  })

  test('a tick inside a segment commits nothing, a change renders two paragraphs', async () => {
    const onCommit = vi.fn()
    const { change } = setup(longOptions, LONG_ID, panel => <Profiler id="panel" onRender={onCommit}>{panel}</Profiler>)
    await screen.findByRole('heading', { name: 'Long recording, 3 hours' }, { timeout: 10000 })
    const [first, second] = longSegments()

    act(() => change({ currentTime: first.start + 0.1 }))
    await waitFor(() => expect(screen.getByTestId('playing')).toBeTruthy())

    onCommit.mockClear()
    paragraphRenders.count = 0
    act(() => change({ currentTime: first.start + 0.2 }))
    act(() => change({ currentTime: first.start + 0.3 }))
    act(() => change({ currentTime: first.start + 0.4 }))
    expect(onCommit).not.toHaveBeenCalled()
    expect(paragraphRenders.count).toBe(0)

    act(() => change({ currentTime: second.start }))
    expect(paragraphRenders.count).toBe(2)
  }, 30000)

  test('an edit renders only its paragraph once the data is back', async () => {
    setup()
    const paragraph = await text(MARK_SECOND)
    await userEvent.hover(paragraph)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const field = screen.getByRole('textbox', { name: 'Paragraph text' })
    await userEvent.type(field, '!')
    paragraphRenders.count = 0
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await text(`${MARK_SECOND}!`)
    await act(() => new Promise(resolve => setTimeout(resolve, 20)))
    expect(paragraphRenders.count).toBeLessThan(8)
  })
})

describe('highlighting a speaker', () => {
  const turnOf = (paragraph: HTMLElement) => paragraph.closest('[data-speaker]')!
  const lit = () => [...document.querySelectorAll('[data-speaker][data-highlighted]')]

  test('marks every turn of that speaker and nothing else, and clearing unmarks them', async () => {
    const { highlight } = setup()
    await text(FIRST)
    act(() => highlight.set(SPEAKER_IDS.mark))
    expect(lit()).toEqual([turnOf(screen.getByText(MARK_FIRST)), turnOf(screen.getByText('Then we can close the import question next week.'))])
    act(() => highlight.set(SPEAKER_IDS.anna))
    expect(lit()).toHaveLength(3)
    expect(lit()).toContain(turnOf(screen.getByText(FIRST)))
    act(() => highlight.set(null))
    expect(lit()).toHaveLength(0)
  })

  test('speakers with no name are marked the same way, each on their own', async () => {
    const { client, highlight } = setup({}, DESIGN_REVIEW_ID)
    const ids = [...new Set((await client.getTranscript(DESIGN_REVIEW_ID)).segments.map(effectiveSpeaker))]
    await screen.findByRole('group', { name: 'Transcript text' })
    for (const id of ids) {
      act(() => highlight.set(id))
      expect(lit().length).toBeGreaterThan(0)
      expect(lit().every(turn => turn.getAttribute('data-speaker') === id)).toBe(true)
    }
  })

  test('a turn that comes with new data is marked too', async () => {
    const { highlight } = setup()
    await userEvent.hover(await text(MARK_FIRST))
    act(() => highlight.set(SPEAKER_IDS.mark))
    await userEvent.click(within(screen.getByRole('toolbar', { name: 'Paragraph' })).getByRole('button', { name: 'More' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText(MARK_FIRST)).toBeNull())
    expect(turnOf(screen.getByText(MARK_SECOND)).hasAttribute('data-highlighted')).toBe(true)
  })

  test('the list does not scroll', async () => {
    const { highlight } = setup()
    await text(FIRST)
    const scroll = document.querySelector<HTMLElement>('[data-transcript-scroll]')!
    const scrollTo = vi.fn()
    scroll.scrollTo = scrollTo
    Element.prototype.scrollIntoView = vi.fn()
    act(() => highlight.set(SPEAKER_IDS.oliver))
    expect(scroll.scrollTop).toBe(0)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  test('on a long recording it commits nothing and renders no paragraph', async () => {
    const onCommit = vi.fn()
    const { highlight } = setup({ board: 'longRecording' }, 1000, panel => <Profiler id="panel" onRender={onCommit}>{panel}</Profiler>)
    await screen.findByRole('heading', { name: 'Long recording, 3 hours' }, { timeout: 10000 })
    const ids = [...new Set(longSegments().map(effectiveSpeaker))]
    onCommit.mockClear()
    paragraphRenders.count = 0
    for (const id of ids) act(() => highlight.set(id))
    act(() => highlight.set(null))
    expect(onCommit).not.toHaveBeenCalled()
    expect(paragraphRenders.count).toBe(0)
  }, 30000)
})

describe('editing', () => {
  const startEdit = async (value: string) => {
    await userEvent.dblClick(await text(value))
    return screen.getByRole('textbox', { name: 'Paragraph text' }) as HTMLTextAreaElement
  }

  test('one paragraph at a time: starting another saves the first', async () => {
    const { client } = setup()
    const save = vi.spyOn(client, 'updateSegmentText')
    const field = await startEdit(MARK_SECOND)
    await userEvent.type(field, ' Really.')
    await userEvent.dblClick(screen.getByText(MARK_FIRST))
    expect(save).toHaveBeenCalledExactlyOnceWith(WEEKLY_SYNC_ID, 8, `${MARK_SECOND} Really.`)
    expect(screen.getAllByRole('textbox', { name: 'Paragraph text' })).toHaveLength(1)
    expect((screen.getByRole('textbox', { name: 'Paragraph text' }) as HTMLTextAreaElement).value).toBe(MARK_FIRST)
  })

  test('the new text shows and survives the refresh', async () => {
    setup()
    const field = await startEdit(MARK_SECOND)
    await userEvent.type(field, ' Really.{Control>}{Enter}{/Control}')
    await text(`${MARK_SECOND} Really.`)
    await act(() => new Promise(resolve => setTimeout(resolve, 20)))
    expect(screen.getByText(`${MARK_SECOND} Really.`)).toBeTruthy()
  })

  test('a failed save puts the text back and says so', async () => {
    const { client } = setup()
    vi.spyOn(client, 'updateSegmentText').mockRejectedValue(new Error('Server error 500'))
    const field = await startEdit(MARK_SECOND)
    await userEvent.type(field, ' Really.{Control>}{Enter}{/Control}')
    await text('Failed to save edit: Server error 500')
    await text(MARK_SECOND)
  })

  test('Esc gives the focus back to the paragraph', async () => {
    setup()
    const field = await startEdit(MARK_SECOND)
    await userEvent.type(field, '{Escape}')
    await waitFor(() => expect(document.activeElement?.textContent).toContain(MARK_SECOND))
  })
})

describe('deleting', () => {
  test('More, Delete removes the segment', async () => {
    const { client } = setup()
    const remove = vi.spyOn(client, 'deleteSegment')
    await userEvent.hover(await text(MARK_SECOND))
    await userEvent.click(within(screen.getByRole('toolbar', { name: 'Paragraph' })).getByRole('button', { name: 'More' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(remove).toHaveBeenCalledExactlyOnceWith(WEEKLY_SYNC_ID, 8)
    await waitFor(() => expect(screen.queryByText(MARK_SECOND)).toBeNull())
  })
})

describe('copying', () => {
  // Chromium refuses navigator.clipboard here: the main process allows only the microphone.
  const clipboard = (writeClipboard: (text: string) => Promise<void>) => {
    vi.stubGlobal('electronAPI', { writeClipboard })
    const browser = vi.fn(async () => { throw new Error('denied') })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: browser }, configurable: true })
    return browser
  }

  test('Copy puts the paragraph on the clipboard through the main process and says so', async () => {
    const writeClipboard = vi.fn(async () => {})
    const browser = clipboard(writeClipboard)
    setup()
    await userEvent.hover(await text(MARK_SECOND))
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith(MARK_SECOND)
    expect(browser).not.toHaveBeenCalled()
    await text('Copied')
  })

  test('a refused clipboard says so', async () => {
    clipboard(async () => { throw new Error('denied') })
    setup()
    await userEvent.hover(await text(MARK_SECOND))
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await text('Copy failed')
  })
})

describe('changing a speaker', () => {
  const openTurnMenu = async () => {
    await text(MARK_SECOND)
    await userEvent.click(screen.getAllByRole('button', { name: 'Mark Ellis' })[0])
    return screen.getByRole('dialog', { name: 'Change speaker' })
  }

  test('the menu lists named speakers of this recording, the current one selected, no New speaker', async () => {
    setup()
    const menu = within(await openTurnMenu())
    expect(menu.getAllByRole('option').map(row => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Anna Petrova')]))
    expect(menu.queryByText(/Unknown/)).toBeNull()
    expect(menu.queryByText(/New speaker/)).toBeNull()
    expect(menu.getByRole('option', { selected: true }).textContent).toContain('Mark Ellis')
    expect(menu.getByText('Show all speakers')).toBeTruthy()
  })

  test('the name of a turn changes all its segments', async () => {
    const { client } = setup()
    const assign = vi.spyOn(client, 'assignSpeaker')
    const menu = within(await openTurnMenu())
    await userEvent.click(menu.getByText('Anna Petrova'))
    expect(assign.mock.calls.map(([call]) => call)).toEqual([{ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [5, 8], target: { id: SPEAKER_IDS.anna } }])
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Mark Ellis' })).toHaveLength(1))
  })

  test('Change speaker on a paragraph changes that segment, at the same menu', async () => {
    const { client } = setup()
    const assign = vi.spyOn(client, 'assignSpeaker')
    await userEvent.hover(await text(MARK_SECOND))
    await userEvent.click(within(screen.getByRole('toolbar', { name: 'Paragraph' })).getByRole('button', { name: 'More' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change speaker' }))
    const menu = within(await screen.findByRole('dialog', { name: 'Change speaker' }))
    await userEvent.click(menu.getByText('Anna Petrova'))
    expect(assign.mock.calls.map(([call]) => call)).toEqual([{ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [8], target: { id: SPEAKER_IDS.anna } }])
  })

  test('a second click on the name closes the menu, without opening it again', async () => {
    setup()
    await openTurnMenu()
    const name = screen.getAllByRole('button', { name: 'Mark Ellis' })[0]
    const reopened: Node[] = []
    const watch = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node instanceof Element && (node.matches('[role="dialog"]') || node.querySelector('[role="dialog"]'))) reopened.push(node)
    })))
    watch.observe(document.body, { childList: true, subtree: true })
    await userEvent.click(name)
    await new Promise(resolve => setTimeout(resolve, 50))
    watch.disconnect()
    expect(reopened).toEqual([])
    expect(screen.queryByRole('dialog', { name: 'Change speaker' })).toBeNull()
    expect(name.getAttribute('aria-expanded')).toBe('false')
  })

  test('the current speaker only closes the menu', async () => {
    const { client } = setup()
    const assign = vi.spyOn(client, 'assignSpeaker')
    const menu = within(await openTurnMenu())
    await userEvent.click(menu.getByRole('option', { selected: true }))
    expect(assign).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('Undo gives a turn back to the speaker it had', async () => {
    const { client } = setup()
    const menu = within(await openTurnMenu())
    await userEvent.click(menu.getByText('Anna Petrova'))
    await text('Assigned to Anna Petrova')
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(async () => {
      const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
      expect(segments.filter(s => [5, 8].includes(s.start)).map(effectiveSpeaker)).toEqual([SPEAKER_IDS.mark, SPEAKER_IDS.mark])
    })
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Mark Ellis' })).toHaveLength(2))
  })

  test('Undo gives one paragraph back', async () => {
    const { client } = setup()
    const undo = vi.spyOn(client, 'undoSpeakerAssignment')
    await userEvent.hover(await text(MARK_SECOND))
    await userEvent.click(within(screen.getByRole('toolbar', { name: 'Paragraph' })).getByRole('button', { name: 'More' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change speaker' }))
    const menu = within(await screen.findByRole('dialog', { name: 'Change speaker' }))
    await userEvent.click(menu.getByText('Anna Petrova'))
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(undo).toHaveBeenCalledOnce())
    expect(undo.mock.calls[0][0]).toEqual({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [8], speakerId: SPEAKER_IDS.mark })
  })

  test('a failed change says so', async () => {
    setup({ overrides: { assignSpeaker: () => Promise.reject(new ApiError(500, 'No')) } })
    const menu = within(await openTurnMenu())
    await userEvent.click(menu.getByText('Anna Petrova'))
    await text('Failed to change speaker: No')
  })

  test('Show all speakers asks for the list', async () => {
    const { onShowAllSpeakers } = setup()
    const menu = within(await openTurnMenu())
    await userEvent.click(menu.getByText('Show all speakers'))
    expect(onShowAllSpeakers).toHaveBeenCalledWith(expect.objectContaining({ currentId: expect.any(String), segmentStarts: expect.any(Array) }))
  })


  test('closing gives the focus back to the name', async () => {
    setup()
    await openTurnMenu()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Mark Ellis' })[0]))
  })
})

describe('renaming', () => {
  const titleButton = () => screen.findByRole('button', { name: 'Weekly product sync' })

  test('Enter saves the trimmed title', async () => {
    const { client } = setup()
    const rename = vi.spyOn(client, 'updateTranscriptTitle')
    await userEvent.click(await titleButton())
    await userEvent.keyboard('  Renamed  {Enter}')
    expect(rename).toHaveBeenCalledExactlyOnceWith(WEEKLY_SYNC_ID, 'Renamed')
    await screen.findByRole('heading', { name: 'Renamed' })
  })

  test('an empty title brings the old one back and sends nothing', async () => {
    const { client } = setup()
    const rename = vi.spyOn(client, 'updateTranscriptTitle')
    await userEvent.click(await titleButton())
    await userEvent.keyboard('{Backspace}{Enter}')
    expect(rename).not.toHaveBeenCalled()
    await titleButton()
  })

  test('a failed rename brings the old title back and says so', async () => {
    const { client } = setup()
    vi.spyOn(client, 'updateTranscriptTitle').mockRejectedValue(new Error('Server error 500'))
    await userEvent.click(await titleButton())
    await userEvent.keyboard('Renamed{Enter}')
    await text('Failed to rename: Server error 500')
    await titleButton()
  })
})

describe('selecting text', () => {
  const select = (node: Node) => {
    const selection = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(node)
    Range.prototype.getClientRects = () => [{ left: 10, top: 100, width: 120, height: 20, right: 130, bottom: 120, x: 10, y: 100, toJSON: () => {} }] as unknown as DOMRectList
    selection.removeAllRanges()
    selection.addRange(range)
    act(() => { fireEvent.mouseUp(document) })
  }
  const bar = () => screen.queryByRole('toolbar', { name: 'Selected text' })

  test('a selection in the text shows Copy and a Highlight that is not available yet', async () => {
    setup()
    select(await text(MARK_SECOND))
    await waitFor(() => expect(bar()).toBeTruthy())
    expect(within(bar()!).getByRole('button', { name: 'Highlight' }).getAttribute('aria-disabled')).toBe('true')
  })

  test('Copy copies the selection and clears it', async () => {
    const writeClipboard = vi.fn(async () => {})
    vi.stubGlobal('electronAPI', { writeClipboard })
    setup()
    select(await text(MARK_SECOND))
    await userEvent.click(within(bar()!).getByRole('button', { name: 'Copy' }))
    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith(MARK_SECOND)
    await text('Copied')
    expect(window.getSelection()!.isCollapsed).toBe(true)
  })

  test('clearing the selection hides the bar', async () => {
    setup()
    select(await text(MARK_SECOND))
    expect(bar()).toBeTruthy()
    act(() => {
      window.getSelection()!.removeAllRanges()
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(bar()).toBeNull()
  })

  test('a selection outside the list shows nothing', async () => {
    setup()
    await text(MARK_SECOND)
    select(screen.getByRole('heading', { name: 'Weekly product sync' }))
    expect(bar()).toBeNull()
  })

  test('nothing shows during an edit', async () => {
    setup()
    const other = await text(MARK_FIRST)
    await userEvent.dblClick(await text(MARK_SECOND))
    select(other)
    // Selecting moved nothing else: the field is still there.
    expect(bar()).toBeNull()
  })
})

describe('keyboard', () => {
  const tabToList = async () => {
    await text(MARK_SECOND)
    // Title, then Pin, Export and More are before the list in the page.
    screen.getByRole('button', { name: 'Weekly product sync' }).focus()
    await userEvent.tab()
    return document.activeElement as HTMLElement
  }

  test('the list is one stop of Tab', async () => {
    setup()
    const first = await tabToList()
    expect(first.textContent!.trim()).toBe('Anna Petrova')
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Weekly product sync' }))
  })

  test('arrows go over the rows and stop at the ends', async () => {
    setup()
    await tabToList()
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement!.textContent!.trim()).toBe('Anna Petrova')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(document.activeElement!.textContent).toContain(FIRST)
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement!.textContent!.trim()).toBe('Mark Ellis')
  })

  test('the bar of a focused paragraph shows, and Enter starts the edit', async () => {
    // jsdom does not work out :focus-visible.
    const matches = Element.prototype.matches
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' || matches.call(this, selector)
    })
    setup()
    await tabToList()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('toolbar', { name: 'Paragraph' })).toBeTruthy()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('textbox', { name: 'Paragraph text' })).toBeTruthy()
    expect(screen.queryByRole('toolbar', { name: 'Paragraph' })).toBeNull()
    vi.restoreAllMocks()
  })

  test('coming back goes to the row it was on', async () => {
    setup()
    await tabToList()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    const row = document.activeElement
    await userEvent.tab({ shift: true })
    await userEvent.tab()
    expect(document.activeElement).toBe(row)
  })
})

describe('scrolling', () => {
  const scrollArea = () => document.querySelector<HTMLElement>('[data-transcript-scroll]')!

  test('the sticky header appears once the header has scrolled away', async () => {
    setup()
    await text(FIRST)
    expect(screen.getAllByRole('button', { name: 'Pin' })).toHaveLength(1)
    fireEvent.scroll(scrollArea(), { target: { scrollTop: 300 } })
    expect(screen.getAllByRole('button', { name: 'Pin' })).toHaveLength(2)
    fireEvent.scroll(scrollArea(), { target: { scrollTop: 0 } })
    expect(screen.getAllByRole('button', { name: 'Pin' })).toHaveLength(1)
  })

  test('new data keeps the place: the list is not rebuilt', async () => {
    const { client } = setup()
    const row = await text(MARK_FIRST)
    fireEvent.scroll(scrollArea(), { target: { scrollTop: 300 } })
    const assign = vi.spyOn(client, 'updateSegmentText')
    await userEvent.dblClick(await text(MARK_SECOND))
    await userEvent.keyboard('!{Control>}{Enter}{/Control}')
    await text(`${MARK_SECOND}!`)
    await act(() => new Promise(resolve => setTimeout(resolve, 20)))
    expect(assign).toHaveBeenCalledOnce()
    expect(scrollArea().scrollTop).toBe(300)
    expect(row.isConnected).toBe(true)
  })
})

test('opening another recording starts clean', async () => {
  const client = createFixtureClient({ board: 'longRecording' })
  const { playback } = fakePlayback()
  function Switch() {
    const [id, setId] = useState(WEEKLY_SYNC_ID)
    return <><button onClick={() => setId(1000)}>other</button><TranscriptPanel transcriptId={id} playback={playback} /></>
  }
  render(<ApiProvider client={client}><OverlayProvider><Switch /></OverlayProvider></ApiProvider>)
  await userEvent.dblClick(await text(MARK_SECOND))
  await userEvent.click(screen.getByRole('button', { name: 'other' }))
  await screen.findByRole('heading', { name: 'Long recording, 3 hours' }, { timeout: 10000 })
  expect(screen.queryByRole('textbox', { name: 'Paragraph text' })).toBeNull()
}, 30000)
