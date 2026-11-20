import type { Meta, StoryObj } from '@storybook/react-vite'
import type { JSONContent } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { useSpeakers, useTranscript } from '../../api/queries'
import { effectiveSpeaker } from '../../api/types'
import { Button } from '../../components/Button/Button'
import { Stack } from '../../components/Stack/Stack'
import { quoteBlock, type NoteQuote } from '../../components/NoteEditor/note-content'
import { NotesPanel, type NotesPanelHandle } from '../../components/NotesPanel/NotesPanel'
import { usePlayback } from '../../media/playback'
import { useTranscriptPlayback } from './EditorPlayer'
import { EditorScreen } from './EditorScreen'
import { mentionCandidates, speakerFinder, WEEKLY_SYNC_MINUTES } from './notes-fixtures'
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

// What a story types into the note, as the keyboard would.
const typeInNote = async (canvasElement: HTMLElement, text: string) => {
  const box = await waitFor(() => canvasElement.querySelector('[role="textbox"][aria-label="Notes"]')) as HTMLElement & { editor?: Editor }
  box.editor?.chain().focus('end').insertContent(text).run()
}

// A sketch of notes on the Editor: the note lives in the story, nothing is stored.
// Timecodes, Quote to notes and mentions are still sketches here.
interface NotesSketchProps {
  tab?: 'speakers' | 'notes'
  expanded?: boolean
  content?: JSONContent | null
  // Text typed into the note once it is there, such as "@an".
  typing?: string
  // The Markdown that Copy notes gives, shown next to the screen.
  showCopied?: boolean
  // Text selected in the transcript, from the start of one paragraph to the end of another.
  select?: [string, string]
  // Quotes taken before the story starts.
  quoted?: NoteQuote[]
}

function NotesSketch({ tab: initialTab = 'notes', expanded: initialExpanded = false, content = null, typing, showCopied, select, quoted }: NotesSketchProps) {
  const speakers = useSpeakers().data
  const transcript = useTranscript(WEEKLY_SYNC_ID).data
  const playback = useTranscriptPlayback(WEEKLY_SYNC_ID)
  const time = usePlayback(playback, state => Math.floor(state.currentTime))
  const [tab, setTab] = useState(initialExpanded ? 'speakers' : initialTab)
  const [expanded, setExpanded] = useState(initialExpanded)
  const [doc, setDoc] = useState<JSONContent | null>(() => (
    quoted ? { type: 'doc', content: [...(content?.content ?? []), ...quoted.map(quoteBlock), { type: 'paragraph' }] } : content
  ))
  const latest = useRef(doc)
  const [copied, setCopied] = useState<string | null>(null)
  const panel = useRef<NotesPanelHandle>(null)

  const inRecording = useMemo(() => [...new Set(transcript?.segments.map(effectiveSpeaker) ?? [])], [transcript])
  const candidates = useMemo(() => mentionCandidates(speakers ?? [], inRecording), [speakers, inRecording])
  const findSpeaker = useMemo(() => speakerFinder(speakers ?? []), [speakers])

  const change = useCallback((next: JSONContent) => { latest.current = next }, [])

  // What a panel starts from: the note as it was left in the other one.
  const keep = () => setDoc(latest.current)
  const toggleExpanded = () => {
    keep()
    setExpanded(was => !was)
    setTab('speakers')
  }
  const copy = (markdown: string) => {
    void window.electronAPI.writeClipboard(markdown)
    setCopied(markdown)
  }
  const quote = useCallback((quotes: NoteQuote[]) => {
    if (panel.current && tab === 'notes') return panel.current.insertQuotes(quotes)
    const base = latest.current?.content ?? []
    const next = { type: 'doc', content: [...base, ...quotes.map(quoteBlock), { type: 'paragraph' }] }
    latest.current = next
    setDoc(next)
    setTab('notes')
  }, [tab])

  useEffect(() => {
    if (!typing || !speakers) return
    const timer = setTimeout(() => panel.current?.type(typing), 300)
    return () => clearTimeout(timer)
  }, [typing, speakers])

  // Escape in the expanded note puts the transcript back.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && !event.defaultPrevented && expanded) toggleExpanded()
  }

  useEffect(() => {
    if (!select) return
    void (async () => {
      const root = document.querySelector('main')!
      // The screen settles after the first paint (turns off screen start at an
      // estimate, text is drawn again): select once the paragraphs stop moving.
      let last = NaN
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 250))
        const top = (await paragraph(root, select[0])).getBoundingClientRect().top
        if (top === last) break
        last = top
      }
      const from = await paragraph(root, select[0])
      const to = await paragraph(root, select[1])
      const range = document.createRange()
      range.setStart(from.firstChild!, 0)
      range.setEnd(to.firstChild!, to.textContent!.length)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      document.dispatchEvent(new MouseEvent('mouseup'))
    })()
  }, [select])

  const ready = speakers !== undefined
  const notesPanel = (mode: 'tab' | 'expanded') => (
    <NotesPanel
      key={mode}
      ref={panel}
      mode={mode}
      title={mode === 'expanded' ? 'Weekly product sync' : undefined}
      content={doc}
      candidates={candidates}
      findSpeaker={findSpeaker}
      time={time}
      onSeek={seconds => playback.seek(seconds)}
      onChange={change}
      onCopy={copy}
      onToggleExpanded={toggleExpanded}
      autoFocus={mode === 'expanded' || typing !== undefined}
    />
  )

  return (
    <div className={styles.stand} onKeyDown={onKeyDown}>
      <div className={boards.board}>
        <EditorScreen
          pinnedIds={[WEEKLY_SYNC_ID, 2]}
          initialSelectedId={WEEKLY_SYNC_ID}
          playback={playback}
          transcript={expanded && ready ? notesPanel('expanded') : undefined}
          notes={{
            tab: !ready ? null : expanded
              ? (
                  <Stack gap={2} padding={2} align="start" className={styles.elsewhere}>
                    <span>The note is open in place of the transcript.</span>
                    <Button size="small" icon="collapse" onClick={toggleExpanded}>Collapse notes</Button>
                  </Stack>
                )
              : notesPanel('tab'),
            inspectorTab: tab,
            onInspectorTab: next => {
              keep()
              setTab(next as 'speakers' | 'notes')
            },
            onQuote: quote,
          }}
        />
      </div>
      {showCopied && (
        <Stack gap={2} className={styles.copied}>
          <span className={styles.copiedTitle}>What Copy notes puts on the clipboard</span>
          <pre className={styles.markdown}>{copied ?? 'Press Copy notes in the Notes tab.'}</pre>
        </Stack>
      )}
    </div>
  )
}

const meta: Meta<typeof NotesSketch> = {
  title: 'Screens/Editor/Notes',
  component: NotesSketch,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof NotesSketch>

type AppStory = StoryObj<typeof AppNotes>

// A recording opens on Speakers; the Notes tab is next to Chapters.
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
// Sketches of what comes next: mentions, quotes and the Markdown of Copy notes with chips.
export const MentionListOpen: Story = { args: { content: WEEKLY_SYNC_MINUTES, typing: '@an' } }
export const MentionSomeoneElse: Story = { args: { content: WEEKLY_SYNC_MINUTES, typing: '@Sam from support' } }
// Text across two turns selected in the transcript: the bar offers Quote to notes.
export const QuoteToNotes: Story = {
  args: { tab: 'speakers', content: WEEKLY_SYNC_MINUTES, select: ['Good. What about the import flow', 'That was me. Files over two hours'] },
}
// What the quote above gives: a quote for each turn, with who and when.
export const QuoteInserted: Story = {
  args: {
    quoted: [
      { speaker: { kind: 'speaker', id: '0b1a6c52-4f0e-4a39-9d57-3c1e8a7f1001', label: 'Anna Petrova' }, start: 10, text: 'Good. What about the import flow? I saw a couple of complaints about large files.' },
      { speaker: { kind: 'speaker', id: 'd2eb392f-b0df-4b0e-8a2e-03efb14a100e', label: 'Unknown speaker 1' }, start: 16, text: 'That was me. Files over two hours took a long time to copy before the job even started.' },
    ],
  },
}
export const CopyNotes: Story = { args: { content: WEEKLY_SYNC_MINUTES, showCopied: true } }
