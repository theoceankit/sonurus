import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { DESIGN_REVIEW_ID, SPEAKER_IDS, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { OverlayProvider } from '../../OverlayProvider'
import type { Playback, PlaybackState } from '../../media/playback'
import { createMockElectronAPI } from '../../platform/electron-api-mock'
import { runBeforeClose } from '../../platform/before-close'
import { announceMentionChange } from '../../api/note-mentions'
import { EditorScreen } from './EditorScreen'
import * as stories from './EditorScreen.notes.stories'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function atWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
}

// A player standing where a test puts it, with no audio element behind it.
function fakePlayback(at: Partial<PlaybackState> = {}) {
  const listeners = new Set<() => void>()
  let state: PlaybackState = { currentTime: 0, duration: 53, paused: true, rate: 1, volume: 1, status: 'ready', ...at }
  const playback: Playback = {
    getState: () => state,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load: () => {},
    reload: () => {},
    toggle: () => {},
    seek: vi.fn(),
    setRate: () => {},
    setVolume: () => {},
  }
  const set = (next: Partial<PlaybackState>) => act(() => {
    state = { ...state, ...next }
    listeners.forEach(listener => listener())
  })
  return { playback, set }
}

async function open(id = WEEKLY_SYNC_ID, options: FixtureOptions = {}, { width = 1200, playback }: { width?: number; playback?: Playback } = {}) {
  atWidth(width)
  const client = createFixtureClient(options)
  const electron = createMockElectronAPI({ openLink: vi.fn(async () => true) })
  window.electronAPI = electron
  render(
    <ApiProvider client={client}>
      <OverlayProvider><EditorScreen initialSelectedId={id} playback={playback} /></OverlayProvider>
    </ApiProvider>,
  )
  await within(center()).findByRole('heading', { level: 1 })
  return { client, electron }
}

const center = () => screen.getByRole('main', { name: 'Transcript' })
const inspector = () => screen.getByRole('region', { name: 'Inspector' })
const tab = (name: string) => within(inspector()).getByRole('tab', { name })
const editorIn = async (root: HTMLElement) => {
  const box = await within(root).findByRole('textbox', { name: 'Notes' })
  return (box as HTMLElement & { editor: Editor }).editor
}
const openNotes = async () => {
  await userEvent.click(tab('Notes'))
  return editorIn(inspector())
}
const text = (value: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] })

describe('the Notes tab', () => {
  test('is a tab like the others and shows the saved note, rendered', async () => {
    await open()
    expect(tab('Speakers').getAttribute('aria-selected')).toBe('true')
    expect(tab('Notes').getAttribute('aria-disabled')).toBeNull()
    await openNotes()
    expect(within(inspector()).getByRole('heading', { level: 1, name: 'Weekly product sync' })).toBeTruthy()
    expect(within(inspector()).getAllByRole('checkbox')).toHaveLength(2)
  })

  test('a recording without a note opens an empty editor', async () => {
    await open(DESIGN_REVIEW_ID)
    const editor = await openNotes()
    expect(editor.isEmpty).toBe(true)
    expect(within(inspector()).getByRole('button', { name: 'Copy notes' }).hasAttribute('disabled')).toBe(true)
  })

  test('another recording opens on Speakers', async () => {
    await open()
    await openNotes()
    await userEvent.click(within(screen.getByLabelText('Recordings')).getByText('Design review').closest('button')!)
    await waitFor(() => expect(within(center()).getByRole('heading', { level: 1 }).textContent).toBe('Design review'))
    expect(tab('Speakers').getAttribute('aria-selected')).toBe('true')
  })

  test('a note that fails to load says so and Retry asks again', async () => {
    let fail = true
    const { client } = await open(WEEKLY_SYNC_ID, {})
    const real = client.getNote.bind(client)
    vi.spyOn(client, 'getNote').mockImplementation(id => (fail ? Promise.reject(new ApiError(500, 'Server error 500')) : real(id)))
    await userEvent.click(within(screen.getByLabelText('Recordings')).getByText('Design review').closest('button')!)
    await waitFor(() => expect(within(center()).getByRole('heading', { level: 1 }).textContent).toBe('Design review'))
    await userEvent.click(tab('Notes'))
    expect(await within(inspector()).findByText('Could not load the notes')).toBeTruthy()
    fail = false
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Retry' }))
    expect(await within(inspector()).findByRole('textbox', { name: 'Notes' })).toBeTruthy()
  })
})

describe('saving', () => {
  test('about a second after typing stops', async () => {
    const { client } = await open(DESIGN_REVIEW_ID)
    const save = vi.spyOn(client, 'saveNote')
    const editor = await openNotes()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    act(() => { editor.commands.insertContent('Decisions') })
    await act(() => vi.advanceTimersByTimeAsync(500))
    act(() => { editor.commands.insertContent(' made') })
    await act(() => vi.advanceTimersByTimeAsync(900))
    expect(save).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(save).toHaveBeenCalledTimes(1)
    expect((await client.getNote(DESIGN_REVIEW_ID)).content).toEqual(text('Decisions made'))
  })

  test('at once when another recording opens, and the note is there when it comes back', async () => {
    const { client } = await open(DESIGN_REVIEW_ID)
    const editor = await openNotes()
    act(() => { editor.commands.insertContent('Before leaving') })
    await userEvent.click(within(screen.getByLabelText('Recordings')).getByText('Weekly product sync').closest('button')!)
    await waitFor(async () => expect((await client.getNote(DESIGN_REVIEW_ID)).content).toEqual(text('Before leaving')))
    await userEvent.click(within(screen.getByLabelText('Recordings')).getByText('Design review').closest('button')!)
    await waitFor(() => expect(within(center()).getByRole('heading', { level: 1 }).textContent).toBe('Design review'))
    expect((await openNotes()).getText()).toBe('Before leaving')
  })

  test('before the window closes', async () => {
    const { client } = await open(DESIGN_REVIEW_ID)
    const editor = await openNotes()
    act(() => { editor.commands.insertContent('Last words') })
    await act(() => runBeforeClose())
    expect((await client.getNote(DESIGN_REVIEW_ID)).content).toEqual(text('Last words'))
  })

  test('an emptied note is deleted', async () => {
    const { client } = await open()
    const editor = await openNotes()
    act(() => { editor.commands.clearContent(true) })
    await act(() => runBeforeClose())
    expect((await client.getNote(WEEKLY_SYNC_ID)).content).toBeNull()
  })

  test('a failure says so once and keeps the text, which is saved on the next try', async () => {
    let fail = true
    const { client } = await open(DESIGN_REVIEW_ID)
    const real = client.saveNote.bind(client)
    vi.spyOn(client, 'saveNote').mockImplementation((id, doc) => (fail ? Promise.reject(new ApiError(0, 'Failed to fetch')) : real(id, doc)))
    const editor = await openNotes()
    act(() => { editor.commands.insertContent('Keep me') })
    await act(() => runBeforeClose())
    expect(await screen.findByText('Failed to save notes: the backend is not reachable')).toBeTruthy()
    expect(editor.getText()).toBe('Keep me')
    await act(() => runBeforeClose())
    expect(screen.getAllByText(/Failed to save notes/)).toHaveLength(1)
    fail = false
    await act(() => runBeforeClose())
    expect((await client.getNote(DESIGN_REVIEW_ID)).content).toEqual(text('Keep me'))
  })
})

describe('expanded over the transcript', () => {
  const expand = async () => {
    await openNotes()
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Expand notes' }))
    return editorIn(center())
  }

  test('takes the place of the transcript with the text so far; the tab says where it is', async () => {
    await open(DESIGN_REVIEW_ID)
    const editor = await openNotes()
    act(() => { editor.commands.insertContent('Not saved yet') })
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Expand notes' }))
    const expanded = await editorIn(center())
    expect(expanded.getText()).toBe('Not saved yet')
    expect(within(center()).queryByRole('heading', { level: 1, name: 'Design review' })).toBeNull()
    expect(within(center()).getByText('Design review')).toBeTruthy()
    expect(tab('Speakers').getAttribute('aria-selected')).toBe('true')
    await userEvent.click(tab('Notes'))
    expect(within(inspector()).getByText('The note is open in place of the transcript.')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Player' })).getByRole('button', { name: 'Play' })).toBeTruthy()
  })

  test('Escape collapses it, typed in or not; the next Escape closes the recording', async () => {
    await open()
    const editor = await expand()
    act(() => { editor.commands.focus() })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(center()).getByRole('heading', { level: 1, name: 'Weekly product sync' })).toBeTruthy())
    expect(tab('Notes').getAttribute('aria-selected')).toBe('true')
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Expand notes' }))
    await editorIn(center())
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(center()).getByRole('heading', { level: 1 })).toBeTruthy())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(center()).queryByRole('heading', { level: 1 })).toBeNull())
  })

  test('Collapse notes in the tab and the button over the note put the transcript back', async () => {
    await open()
    await expand()
    await userEvent.click(tab('Notes'))
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Collapse notes' }))
    await waitFor(() => expect(within(center()).getByRole('heading', { level: 1, name: 'Weekly product sync' })).toBeTruthy())
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Expand notes' }))
    await userEvent.click(await within(center()).findByRole('button', { name: 'Collapse notes' }))
    await waitFor(() => expect(within(center()).getByRole('heading', { level: 1, name: 'Weekly product sync' })).toBeTruthy())
  })

  test('another recording opens with its transcript', async () => {
    await open()
    await expand()
    await userEvent.click(within(screen.getByLabelText('Recordings')).getByText('Design review').closest('button')!)
    await waitFor(() => expect(within(center()).getByRole('heading', { level: 1, name: 'Design review' })).toBeTruthy())
  })
})

describe('links and copying', () => {
  test('a plain click on a link opens nothing; Ctrl or ⌘ click hands it to the system', async () => {
    const { electron } = await open()
    await openNotes()
    const link = within(inspector()).getByText('support')
    fireEvent.click(link)
    expect(electron.openLink).not.toHaveBeenCalled()
    fireEvent.click(link, { ctrlKey: true })
    fireEvent.click(link, { metaKey: true })
    expect(electron.openLink).toHaveBeenCalledTimes(2)
    expect(electron.openLink).toHaveBeenCalledWith('mailto:support@example.com')
  })

  test('Copy notes puts the note on the clipboard as Markdown, without a toast', async () => {
    const { electron } = await open()
    await openNotes()
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Copy notes' }))
    await waitFor(() => expect(electron.clipboard()).toMatch(/^# Weekly product sync\n\nFriday's release went out \*\*without crashes\*\*\./))
    expect(electron.clipboard()).toContain('- [x] Draft the release notes\n- [ ] Ask support about the import errors')
    expect(electron.clipboard()).toContain('Questions: [support](mailto:support@example.com)')
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('deleting a recording with a note', () => {
  test('the dialog says the notes go too, and they do', async () => {
    const { client } = await open()
    await userEvent.click((await screen.findAllByRole('button', { name: 'More' }))[0])
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete recording' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/The transcript, its notes and its recording/)).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await expect(client.getNote(WEEKLY_SYNC_ID)).rejects.toMatchObject({ status: 404 })
  })

  test('without a note the dialog does not mention notes', async () => {
    await open(DESIGN_REVIEW_ID)
    await userEvent.click((await screen.findAllByRole('button', { name: 'More' }))[0])
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete recording' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).queryByText(/notes/)).toBeNull()
  })
})

describe('the player time', () => {
  const timeButton = () => within(inspector()).getByRole('button', { name: 'Insert player time' })
  const timecodes = (editor: Editor) => {
    const found: number[] = []
    editor.state.doc.descendants(node => { if (node.type.name === 'timecode') found.push(node.attrs.seconds) })
    return found
  }

  test('the button is only an icon and puts where the player stands in the note as a chip', async () => {
    const { playback, set } = fakePlayback({ currentTime: 754.6 })
    await open(DESIGN_REVIEW_ID, {}, { playback })
    const editor = await openNotes()
    expect(timeButton().textContent!.trim()).toBe('')
    expect(within(within(inspector()).getByRole('toolbar', { name: 'Format' })).getByRole('button', { name: 'Insert player time' })).toBe(timeButton())
    set({ currentTime: 800.2 })
    await userEvent.click(timeButton())
    expect(timecodes(editor)).toEqual([800])
    expect(within(inspector()).getByRole('button', { name: 'Go to 13:20' })).toBeTruthy()
  })

  test('goes where the cursor was in the note, or to the end when it never was there', async () => {
    const { playback } = fakePlayback({ currentTime: 5 })
    await open(DESIGN_REVIEW_ID, {}, { playback })
    const editor = await openNotes()
    act(() => { editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] }) })
    await userEvent.click(timeButton())
    expect(editor.getJSON().content?.[1].content?.map(node => node.type)).toEqual(['text', 'timecode', 'text'])
    act(() => { editor.commands.setTextSelection(3) })
    act(() => { editor.commands.focus() })
    act(() => { editor.commands.blur() })
    await userEvent.click(timeButton())
    expect(editor.getJSON().content?.[0].content?.map(node => node.type)).toEqual(['text', 'timecode', 'text'])
  })

  test('is not available until the audio is there', async () => {
    const { playback, set } = fakePlayback({ currentTime: 0, status: 'loading' })
    await open(DESIGN_REVIEW_ID, {}, { playback })
    await openNotes()
    expect(timeButton().hasAttribute('disabled')).toBe(true)
    set({ status: 'error' })
    expect(timeButton().hasAttribute('disabled')).toBe(true)
    set({ status: 'ready' })
    expect(timeButton().hasAttribute('disabled')).toBe(false)
  })

  test('has no shortcut: Ctrl T in the note inserts nothing', async () => {
    const { playback } = fakePlayback({ currentTime: 12 })
    await open(DESIGN_REVIEW_ID, {}, { playback })
    const editor = await openNotes()
    act(() => { editor.commands.focus() })
    await userEvent.keyboard('{Control>}t{/Control}')
    expect(timecodes(editor)).toEqual([])
    expect(timeButton().getAttribute('aria-keyshortcuts')).toBeNull()
  })

  test('after a click on a chip, the next one goes beside it rather than in its place', async () => {
    const { playback, set } = fakePlayback({ currentTime: 75 })
    await open(DESIGN_REVIEW_ID, {}, { playback })
    const editor = await openNotes()
    await userEvent.click(timeButton())
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Go to 01:15' }))
    // A click on the chip in a browser selects it as a whole (ProseMirror's mousedown).
    let chip = 0
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'timecode') chip = pos })
    act(() => { editor.commands.setNodeSelection(chip) })
    set({ currentTime: 90 })
    await userEvent.click(timeButton())
    expect(timecodes(editor)).toEqual([75, 90])
  })

  test('a click on a chip takes the player there', async () => {
    const { playback } = fakePlayback({ currentTime: 75 })
    await open(DESIGN_REVIEW_ID, {}, { playback })
    await openNotes()
    await userEvent.click(timeButton())
    await userEvent.click(within(inspector()).getByRole('button', { name: 'Go to 01:15' }))
    expect(playback.seek).toHaveBeenCalledExactlyOnceWith(75)
  })
})

describe('Quote', () => {
  const paragraphOf = (text: string) => within(center()).getByText(text)
  // jsdom lays nothing out, and the bar stands over the first line selected.
  const layOutRanges = () => {
    Range.prototype.getClientRects = () => [{ left: 10, top: 100, width: 120, height: 20, right: 130, bottom: 120, x: 10, y: 100, toJSON: () => {} }] as unknown as DOMRectList
  }
  // From the start of one paragraph of the transcript to the end of another, as a drag does.
  const select = async (from: string, to: string) => {
    const first = await within(center()).findByText(from)
    const last = paragraphOf(to)
    const range = document.createRange()
    range.setStart(first.firstChild!, 0)
    range.setEnd(last.firstChild!, last.textContent!.length)
    layOutRanges()
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    act(() => { fireEvent.mouseUp(document) })
    return screen.findByRole('toolbar', { name: 'Selected text' })
  }
  const quote = async (from: string, to: string) => {
    await userEvent.click(within(await select(from, to)).getByRole('button', { name: 'Quote' }))
  }
  const GOOD = 'Good. What about the import flow? I saw a couple of complaints about large files.'
  const THAT_WAS_ME = 'That was me. Files over two hours took a long time to copy before the job even started.'
  // Quotes taken from the transcript: they open with who said it.
  const quotes = (editor: Editor) => ((editor.getJSON() as JSONContent).content ?? []).filter(node => node.type === 'blockquote' && node.content?.[0].content?.[0]?.type === 'mention')
  const quoteHead = (block: JSONContent) => block.content?.[0].content?.map(node => node.type === 'mention' ? node.attrs : node.type === 'timecode' ? node.attrs?.seconds : node.text)

  // Storybook runs a play by itself and shows its failure only in the browser.
  test.each([
    ['QuoteInserted', WEEKLY_SYNC_ID, 2],
    ['QuoteIntoEmptyNote', DESIGN_REVIEW_ID, 1],
  ] as const)('the play of the story %s presses Quote', async (name, id, count) => {
    await open(id)
    layOutRanges()
    const play = stories[name].play as (context: { canvasElement: HTMLElement }) => Promise<void>
    await play({ canvasElement: document.body })
    const editor = await editorIn(inspector())
    await waitFor(() => expect(quotes(editor)).toHaveLength(count))
  })

  test('from the Speakers tab: the Notes tab opens with a quote for each turn, and the note is saved', async () => {
    const { client } = await open()
    const before = (await client.getNote(WEEKLY_SYNC_ID)).content
    expect(tab('Speakers').getAttribute('aria-selected')).toBe('true')
    await quote(GOOD, THAT_WAS_ME)
    await waitFor(() => expect(tab('Notes').getAttribute('aria-selected')).toBe('true'))
    const editor = await editorIn(inspector())
    await waitFor(() => expect(quotes(editor)).toHaveLength(2))
    const [first, second] = quotes(editor)
    expect(quoteHead(first)).toMatchObject([{ id: SPEAKER_IDS.anna, label: 'Anna Petrova', kind: 'speaker' }, ' ', 10])
    expect(first.content?.[1].content?.[0].text).toBe(GOOD)
    expect(quoteHead(second)).toMatchObject([{ id: SPEAKER_IDS.unknown1, label: 'Unknown speaker 1', kind: 'speaker' }, ' ', 16])
    expect(second.content?.[1].content?.[0].text).toBe(THAT_WAS_ME)
    expect(window.getSelection()!.isCollapsed).toBe(true)
    await act(() => runBeforeClose())
    const saved = (await client.getNote(WEEKLY_SYNC_ID)).content as { content: { type: string }[] }
    expect(saved).not.toEqual(before)
    expect(JSON.stringify(saved)).toContain(THAT_WAS_ME)
  })

  test('into a recording without a note: the note is made', async () => {
    const { client } = await open(DESIGN_REVIEW_ID)
    const [firstText] = (await client.getTranscript(DESIGN_REVIEW_ID)).segments
    await quote(firstText.text, firstText.text)
    const editor = await editorIn(inspector())
    await waitFor(() => expect(quotes(editor)).toHaveLength(1))
    await act(() => runBeforeClose())
    expect((await client.getNote(DESIGN_REVIEW_ID)).content).not.toBeNull()
  })

  test('with the Notes tab open: at the cursor of the note', async () => {
    await open()
    const editor = await openNotes()
    act(() => { editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] }) })
    act(() => { editor.commands.setTextSelection(6) })
    act(() => { editor.commands.focus() })
    act(() => { editor.commands.blur() })
    // The editor clears the page's selection a frame after it lets the focus go.
    await act(() => new Promise(resolve => requestAnimationFrame(resolve)))
    await quote(GOOD, GOOD)
    await waitFor(() => expect(quotes(editor)).toHaveLength(1))
    expect((editor.getJSON() as JSONContent).content!.map(node => node.type === 'paragraph' ? node.content?.[0]?.text ?? '' : node.type)).toEqual(['First', 'blockquote', '', 'Second'])
  })

  test('a named speaker is a chip, one with no name yet is the label the transcript shows', async () => {
    await open()
    await quote(GOOD, THAT_WAS_ME)
    await editorIn(inspector())
    await waitFor(() => expect(within(inspector()).getAllByText('Unknown speaker 1').length).toBeGreaterThan(0))
    const mentions = [...inspector().querySelectorAll<HTMLElement>('blockquote [data-mention="speaker"]')]
    expect(mentions).toHaveLength(2)
    expect(mentions[0].textContent).toMatch(/Anna Petrova$/)
    expect(mentions[0].firstElementChild!.childElementCount).toBe(2)
    expect(mentions[1].firstElementChild!.childElementCount).toBe(0)
    expect(mentions[1].textContent).toBe('Unknown speaker 1')
  })

  test('in a narrow window the right panel comes in place of the sidebar', async () => {
    await open(WEEKLY_SYNC_ID, {}, { width: 1000 })
    const slot = document.querySelector('section[aria-label="Inspector"]')!
    expect(slot.hasAttribute('inert')).toBe(true)
    await quote(GOOD, GOOD)
    await waitFor(() => expect(slot.hasAttribute('inert')).toBe(false))
    expect(tab('Notes').getAttribute('aria-selected')).toBe('true')
    const editor = await editorIn(inspector())
    await waitFor(() => expect(quotes(editor)).toHaveLength(1))
  })
})

describe('mentions', () => {
  // As the keyboard types: the @ list follows the text before the cursor.
  const typeIn = (editor: Editor, value: string) => act(() => {
    for (const char of value) {
      const { view } = editor
      const { from, to } = view.state.selection
      view.dispatch(view.state.tr.insertText(char, from, to))
    }
  })
  const list = () => screen.findByRole('listbox', { name: 'Mention' })
  const key = (editor: Editor, name: string) => act(() => {
    editor.view.someProp('handleKeyDown', handle => handle(editor.view, new KeyboardEvent('keydown', { key: name })))
  })
  const mentionsIn = (editor: Editor) => {
    const found: Record<string, unknown>[] = []
    editor.state.doc.descendants(node => { if (node.type.name === 'mention') found.push(node.attrs) })
    return found
  }

  test('@ offers the speakers of this recording, then the others; Enter mentions the first', async () => {
    await open(DESIGN_REVIEW_ID)
    const editor = await openNotes()
    act(() => { editor.commands.focus('end') })
    typeIn(editor, '@')
    const shown = await list()
    const groups = within(shown).getAllByRole('group')
    expect(groups.map(group => group.getAttribute('aria-label'))).toEqual(['In this recording', 'Other speakers'])
    const first = within(groups[0]).getAllByRole('option')[0]
    expect(first.getAttribute('aria-selected')).toBe('true')
    const name = first.querySelector('[class*=label]')!.textContent!
    key(editor, 'Enter')
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Mention' })).toBeNull())
    expect(mentionsIn(editor)).toEqual([expect.objectContaining({ kind: 'speaker', label: name })])
    expect(await within(inspector()).findByText(name)).toBeTruthy()
  })

  test('a search finds a speaker by handle; someone not in the base is mentioned as typed', async () => {
    await open(DESIGN_REVIEW_ID)
    const editor = await openNotes()
    act(() => { editor.commands.focus('end') })
    typeIn(editor, '@mark.ellis')
    expect(within(await list()).getAllByRole('option').map(option => option.querySelector('[class*=label]')!.textContent)).toEqual(['Mark Ellis', 'Mention "mark.ellis"'])
    key(editor, 'Escape')
    act(() => { editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }) })
    act(() => { editor.commands.focus('end') })
    typeIn(editor, '@Sam from support')
    expect(within(await list()).getAllByRole('option').map(option => option.querySelector('[class*=label]')!.textContent)).toEqual(['Mention "Sam from support"'])
    key(editor, 'Enter')
    expect(mentionsIn(editor)).toEqual([expect.objectContaining({ kind: 'person', id: null, label: 'Sam from support' })])
  })

  test('a merged or deleted speaker: the open note follows and is saved', async () => {
    const { client } = await open(DESIGN_REVIEW_ID)
    const editor = await openNotes()
    act(() => {
      editor.commands.insertContent([
        { type: 'mention', attrs: { kind: 'speaker', id: SPEAKER_IDS.mark, label: 'Mark' } },
        { type: 'text', text: ' and ' },
        { type: 'mention', attrs: { kind: 'speaker', id: SPEAKER_IDS.anna, label: 'Anna' } },
      ])
    })
    act(() => announceMentionChange({ kind: 'merge', from: SPEAKER_IDS.mark, into: SPEAKER_IDS.lena }))
    act(() => announceMentionChange({ kind: 'delete', id: SPEAKER_IDS.anna, name: 'Anna Petrova' }))
    expect(mentionsIn(editor).map(attrs => attrs.id)).toEqual([SPEAKER_IDS.lena])
    expect(await within(inspector()).findByText('Lena Kovacs')).toBeTruthy()
    expect(editor.getText()).toBe('@Mark and Anna Petrova')
    await waitFor(async () => expect(JSON.stringify((await client.getNote(DESIGN_REVIEW_ID)).content)).toContain('Anna Petrova'), { timeout: 3000 })
    expect(JSON.stringify((await client.getNote(DESIGN_REVIEW_ID)).content)).not.toContain(SPEAKER_IDS.anna)
  })
})
