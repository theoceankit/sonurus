import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { useWriteNote } from '../../api/queries'
import { toast } from '../../components/Toast/toast-store'
import { onBeforeClose } from '../../platform/before-close'
import { createNoteAutosave, type NoteAutosave } from './note-autosave'

const failure = (error: unknown) => (error instanceof ApiError && error.status === 0
  ? 'the backend is not reachable'
  : error instanceof Error ? error.message : String(error))

// One saver for the notes of the screen: it saves about a second after typing stops,
// and at once when the recording shown changes, when the screen goes and before the
// window closes. A failure says so once; the text stays in the editor and is tried
// again with the next change or the next of those moments.
export function useNotesSaver(shownId: number | null): NoteAutosave {
  const write = useWriteNote()
  // The saver is made once; the write it uses is the one of the latest render.
  const latestWrite = useRef(write)
  latestWrite.current = write
  const [saver] = useState(() => createNoteAutosave({
    write: (id, doc) => latestWrite.current(id, doc),
    onFailure: error => toast({ message: `Failed to save notes: ${failure(error)}`, type: 'error' }),
  }))

  useEffect(() => onBeforeClose(saver.flush), [saver])
  useEffect(() => () => { void saver.flush() }, [saver])
  // Leaving a recording, for another one, a job or nothing.
  useEffect(() => { void saver.flush() }, [saver, shownId])
  return saver
}
