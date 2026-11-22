import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { Stack } from '../../components/Stack/Stack'
import { EditorScreen } from './EditorScreen'
import { WEEKLY_SYNC_MINUTES } from './notes-fixtures'
import { paragraph, waitFor } from './story-helpers'
import { ApiError } from '../../api/client'
import { DESIGN_REVIEW_ID } from '../../api/fixtures/data'
import type { Editor } from '@tiptap/core'
import styles from './EditorScreen.notes.stories.module.css'
import boards from './EditorScreen.stories.module.css'

// The notes as the app has them: stored through the API on fixtures (the weekly sync
// has a note), saved as they are typed.
function AppNotes({ id = WEEKLY_SYNC_ID, tab, expanded }: { id?: number; tab?: 'speakers' | 'notes'; expanded?: boolean }) {
  return (
    <div className={boards.board}>
      <EditorScreen pinnedIds={[WEEKLY_SYNC_ID, 2]} initialSelectedId={id} initialNotes={{ tab, expanded }} />
    </div>
  )
}

// Text selected in the transcript, from the start of one paragraph to the end of another,
// as a drag does; then, if asked, Quote on the bar that comes up.
const selectInTranscript = async (canvasElement: HTMLElement, [from, to]: [string, string], quote = false) => {
  const root = canvasElement.querySelector('main')!
  // The screen settles after the first paint (turns off screen start at an estimate,
  // text is drawn again): select once the paragraphs stop moving.
  let last = NaN
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 250))
    const top = (await paragraph(root, from)).getBoundingClientRect().top
    if (top === last) break
    last = top
  }
  const first = await paragraph(root, from)
  const end = await paragraph(root, to)
  const range = document.createRange()
  range.setStart(first.firstChild!, 0)
  range.setEnd(end.firstChild!, end.textContent!.length)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  document.dispatchEvent(new MouseEvent('mouseup'))
  if (!quote) return
  const button = await waitFor(() => [...canvasElement.querySelectorAll('button')].find(node => node.textContent === 'Quote'))
  button.click()
}

// What a story types into the note, as the keyboard would.
const typeInNote = async (canvasElement: HTMLElement, text: string) => {
  const box = await waitFor(() => canvasElement.querySelector('[role="textbox"][aria-label="Notes"]')) as HTMLElement & { editor?: Editor }
  box.editor?.chain().focus('end').insertContent(text).run()
}

// The notes of the weekly sync with every chip, as stored: two speakers of the
// recording, others from the base, someone not in it and a speaker deleted since.
const withMinutes = { api: { overrides: { getNote: (id: number) => Promise.resolve(id === WEEKLY_SYNC_ID ? { content: WEEKLY_SYNC_MINUTES, updated_at: null } : { content: null, updated_at: null }) } } }

// What Copy notes puts on the clipboard, next to the screen.
function CopyStand() {
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    const write = window.electronAPI.writeClipboard
    window.electronAPI.writeClipboard = async text => {
      setCopied(text)
      return write(text)
    }
    return () => { window.electronAPI.writeClipboard = write }
  }, [])
  return (
    <div className={styles.stand}>
      <AppNotes tab="notes" />
      <Stack gap={2} className={styles.copied}>
        <span className={styles.copiedTitle}>What Copy notes puts on the clipboard</span>
        <pre className={styles.markdown}>{copied ?? 'Press Copy notes in the Notes tab.'}</pre>
      </Stack>
    </div>
  )
}

const meta: Meta<typeof AppNotes> = {
  title: 'Screens/Editor/Notes',
  component: AppNotes,
  parameters: { layout: 'fullscreen' },
}
export default meta

type AppStory = StoryObj<typeof AppNotes>

// A recording opens on Speakers; the Notes tab is next to it.
export const Closed: AppStory = { render: args => <AppNotes {...args} />, args: { tab: 'speakers' } }
// No note yet: an empty editor that says what Markdown does.
export const NotesTabEmpty: AppStory = { render: args => <AppNotes {...args} />, args: { id: DESIGN_REVIEW_ID, tab: 'notes' } }
export const NotesTabWithText: AppStory = { render: args => <AppNotes {...args} />, args: { tab: 'notes' } }
// In place of the transcript, the player still there. Escape or Collapse puts it back.
export const NotesExpanded: AppStory = { render: args => <AppNotes {...args} />, args: { expanded: true } }
// Every save fails, as with the backend gone: typing says so once, the text stays.
export const SaveFailed: AppStory = {
  render: args => <AppNotes {...args} />,
  args: { id: DESIGN_REVIEW_ID, tab: 'notes' },
  parameters: { api: { overrides: { saveNote: () => Promise.reject(new ApiError(0, 'Failed to fetch')) } } },
  play: ({ canvasElement }) => typeInNote(canvasElement, 'Decisions'),
}
// Under 1112 px only one side panel shows: here the inspector, with its Notes tab.
export const NarrowWindow: AppStory = {
  render: args => <AppNotes {...args} />,
  args: { tab: 'notes' },
  decorators: [Story => <div className={styles.narrow}><Story /></div>],
  play: async ({ canvasElement }) => {
    const show = await waitFor(() => canvasElement.querySelector<HTMLElement>('button[aria-label="Show inspector"]'))
    show.click()
  },
}
// Chips: speakers by their current name and photo, someone not in the base without
// an avatar, a deleted speaker as text.
export const NotesWithMentions: AppStory = { render: args => <AppNotes {...args} />, args: { tab: 'notes' }, parameters: withMinutes }
// @ offers the speakers of this recording first, then the others; a search looks at
// names and handles.
export const MentionListOpen: AppStory = {
  render: args => <AppNotes {...args} />,
  args: { tab: 'notes' },
  parameters: withMinutes,
  play: ({ canvasElement }) => typeInNote(canvasElement, ' @an'),
}
// No one found: the name as typed, for someone not in the base.
export const MentionSomeoneElse: AppStory = {
  render: args => <AppNotes {...args} />,
  args: { tab: 'notes' },
  parameters: withMinutes,
  play: ({ canvasElement }) => typeInNote(canvasElement, ' @Sam from support'),
}
const ACROSS_TWO_TURNS: [string, string] = ['Good. What about the import flow', 'That was me. Files over two hours']
// Text across two turns selected in the transcript: the bar offers Quote.
export const QuoteToNotes: AppStory = {
  render: args => <AppNotes {...args} />,
  args: { tab: 'speakers' },
  play: ({ canvasElement }) => selectInTranscript(canvasElement, ACROSS_TWO_TURNS),
}
// What the quote above gives: the Notes tab opens with a quote for each turn, who and
// when; a speaker with no name yet reads as the transcript calls them.
export const QuoteInserted: AppStory = {
  render: args => <AppNotes {...args} />,
  args: { tab: 'speakers' },
  play: ({ canvasElement }) => selectInTranscript(canvasElement, ACROSS_TWO_TURNS, true),
}
// Into a recording with no note: the note is made.
export const QuoteIntoEmptyNote: AppStory = {
  render: args => <AppNotes {...args} />,
  args: { id: DESIGN_REVIEW_ID, tab: 'speakers' },
  play: ({ canvasElement }) => selectInTranscript(canvasElement, ["Let's look at the new inspector", "Let's look at the new inspector"], true),
}
export const CopyNotes: AppStory = { render: () => <CopyStand />, parameters: withMinutes }
