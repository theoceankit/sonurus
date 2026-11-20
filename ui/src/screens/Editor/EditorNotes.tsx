import type { JSONContent } from '@tiptap/react'
import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys, useKeepNote, useNote, useSpeakers } from '../../api/queries'
import type { Note, NoteDocument } from '../../api/types'
import { Button } from '../../components/Button/Button'
import type { NoteQuote } from '../../components/NoteEditor/note-content'
import { Stack } from '../../components/Stack/Stack'
import { usePlayback, type Playback } from '../../media/playback'
import type { NoteAutosave } from './note-autosave'
import { speakerFinder } from './note-speakers'
import styles from './EditorNotes.module.css'

interface EditorNotesProps {
  transcriptId: number
  // Tab: in the right panel. Expanded: in place of the transcript.
  mode: 'tab' | 'expanded'
  title?: string
  saver: NoteAutosave
  // The player of the recording: its time goes into the note, a chip takes it back there.
  playback: Playback
  // Quotes from the transcript to insert once the editor is there; onQuoted says they are in.
  quotes?: NoteQuote[] | null
  onQuoted?: () => void
  onToggleExpanded: () => void
}

// The editor (Tiptap and ProseMirror) is a third of the UI's code: it loads the
// first time a note opens, not with the window.
const NotesPanel = lazy(() => import('../../components/NotesPanel/NotesPanel').then(module => ({ default: module.NotesPanel })))

const copy = (markdown: string) => { void window.electronAPI?.writeClipboard(markdown) }
const openLink = (href: string) => { void window.electronAPI?.openLink(href) }

// The note of a recording, saved as it is typed. It opens with what the editor had
// last, saved or not, so moving it between the tab and the transcript loses nothing.
export function EditorNotes({ transcriptId, mode, title, saver, playback, quotes, onQuoted, onToggleExpanded }: EditorNotesProps) {
  const note = useNote(transcriptId)
  const speakers = useSpeakers().data
  const findSpeaker = useMemo(() => speakerFinder(speakers ?? []), [speakers])
  const keep = useKeepNote()
  // The same function for every render, so the editor does not render with the player's time.
  const change = useCallback((doc: JSONContent) => {
    keep(transcriptId, doc as NoteDocument)
    saver.change(transcriptId, doc as NoteDocument)
  }, [keep, saver, transcriptId])

  if (note.isError && !note.data) {
    return (
      <Stack gap={2} padding={2} align="start" className={styles.message}>
        <span>Could not load the notes</span>
        <Button variant="secondary" size="small" onClick={() => void note.refetch()}>Retry</Button>
      </Stack>
    )
  }
  if (!note.data) return null
  return (
    <Suspense fallback={null}>
      <NoteBody
        key={`${transcriptId} ${mode}`}
        transcriptId={transcriptId}
        mode={mode}
        title={title}
        findSpeaker={findSpeaker}
        playback={playback}
        quotes={quotes}
        onQuoted={onQuoted}
        onChange={change}
        onToggleExpanded={onToggleExpanded}
      />
    </Suspense>
  )
}

interface NoteBodyProps extends Omit<EditorNotesProps, 'saver'> {
  findSpeaker: ReturnType<typeof speakerFinder>
  onChange: (doc: JSONContent) => void
}

// The editor reads the note once, as it opens: what it has after that is its own,
// and the cache follows it rather than the other way round.
function NoteBody({ transcriptId, mode, title, findSpeaker, playback, quotes, onQuoted, onChange, onToggleExpanded }: NoteBodyProps) {
  const queries = useQueryClient()
  const [content] = useState(() => queries.getQueryData<Note>(queryKeys.note(transcriptId))?.content as JSONContent | null | undefined)
  const time = usePlayback(playback, state => Math.floor(state.currentTime))
  const ready = usePlayback(playback, state => state.status === 'ready')
  const seek = useCallback((seconds: number) => playback.seek(seconds), [playback])
  return (
    <NotesPanel
      mode={mode}
      title={title}
      content={content}
      findSpeaker={findSpeaker}
      time={time}
      timeDisabled={!ready}
      onSeek={seek}
      quotes={quotes}
      onQuoted={onQuoted}
      onChange={onChange}
      onCopy={copy}
      onOpenLink={openLink}
      onToggleExpanded={onToggleExpanded}
      autoFocus={mode === 'expanded'}
    />
  )
}

// The Notes tab while the note is open in place of the transcript.
export function NotesElsewhere({ onCollapse }: { onCollapse: () => void }) {
  return (
    <Stack gap={2} padding={2} align="start" className={styles.message}>
      <span>The note is open in place of the transcript.</span>
      <Button size="small" icon="collapse" onClick={onCollapse}>Collapse notes</Button>
    </Stack>
  )
}
