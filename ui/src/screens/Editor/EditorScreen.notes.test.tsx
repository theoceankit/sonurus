import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/core'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { DESIGN_REVIEW_ID, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { OverlayProvider } from '../../OverlayProvider'
import { createMockElectronAPI } from '../../platform/electron-api-mock'
import { runBeforeClose } from '../../platform/before-close'
import { EditorScreen } from './EditorScreen'

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

async function open(id = WEEKLY_SYNC_ID, options: FixtureOptions = {}) {
  atWidth(1200)
  const client = createFixtureClient(options)
  const electron = createMockElectronAPI({ openLink: vi.fn(async () => true) })
  window.electronAPI = electron
  render(
    <ApiProvider client={client}>
      <OverlayProvider><EditorScreen initialSelectedId={id} /></OverlayProvider>
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
    expect(within(inspector()).queryByRole('button', { name: 'Insert player time' })).toBeNull()
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
