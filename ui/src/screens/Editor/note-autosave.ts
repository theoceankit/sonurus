import { ApiError } from '../../api/client'
import type { NoteDocument } from '../../api/types'
import { isEmptyNote } from '../../components/NoteEditor/note-content'

// About a second after typing stops.
export const NOTE_SAVE_DELAY_MS = 1000

export interface NoteAutosave {
  // The editor's document of a recording, to be saved after the delay.
  change: (transcriptId: number, doc: NoteDocument) => void
  // Saves whatever waits, now; resolves once it is saved or has failed.
  flush: () => Promise<void>
  // Something is not saved yet.
  pending: () => boolean
}

interface NoteAutosaveOptions {
  // Saves the note; null deletes it, as an empty note is no note.
  write: (transcriptId: number, doc: NoteDocument | null) => Promise<void>
  // The first failure of a run of them; the document waits for the next try.
  onFailure: (error: unknown) => void
  delayMs?: number
}

// Saves notes one request at a time, newest document only, so an answer that comes
// late never stands for older text. A failed save keeps its document until the next
// change or flush, unless a newer one has come since.
export function createNoteAutosave({ write, onFailure, delayMs = NOTE_SAVE_DELAY_MS }: NoteAutosaveOptions): NoteAutosave {
  const waiting = new Map<number, NoteDocument>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let chain = Promise.resolve()
  let failing = false

  const run = async () => {
    for (const [id, doc] of [...waiting]) {
      if (waiting.get(id) !== doc) continue
      waiting.delete(id)
      try {
        await write(id, isEmptyNote(doc) ? null : doc)
        failing = false
      } catch (error) {
        // The recording was deleted meanwhile: its note went with it.
        if (error instanceof ApiError && error.status === 404) continue
        if (!waiting.has(id)) waiting.set(id, doc)
        if (!failing) onFailure(error)
        failing = true
        return
      }
    }
  }

  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    chain = chain.then(run)
    return chain
  }

  return {
    change: (id, doc) => {
      waiting.set(id, doc)
      clearTimeout(timer)
      timer = setTimeout(() => void flush(), delayMs)
    },
    flush,
    pending: () => waiting.size > 0,
  }
}
