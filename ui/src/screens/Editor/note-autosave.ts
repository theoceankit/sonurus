import { ApiError } from '../../api/client'
import type { NoteDocument, NoteWriter } from '../../api/types'
import { isEmptyNote, rewriteMentions, type MentionChange } from '../../components/NoteEditor/note-content'
import { mergeNotes, sameNote } from '../../components/NoteEditor/note-merge'

// About a second after typing stops.
export const NOTE_SAVE_DELAY_MS = 1000

// A note as the backend has it: its document (null: no note) and version.
export interface StoredNote {
  content: NoteDocument | null
  version: number | null
  // Who wrote it last, where the backend says.
  writer?: NoteWriter | null
}

export interface NoteAutosave {
  // The editor's document of a recording, to be saved after the delay.
  change: (transcriptId: number, doc: NoteDocument) => void
  // Saves whatever waits, and reads what changed elsewhere, now; resolves once done or failed.
  flush: () => Promise<void>
  // Something is not saved yet.
  pending: () => boolean
  // The note as the editor opened it: what its changes are made from. The first one
  // given for a recording counts; after that the saver keeps up with its own writes.
  loaded: (transcriptId: number, note: StoredNote) => void
  // The note changed on the backend (note_changed; version null: deleted). False when
  // the saver does not keep that note.
  heard: (transcriptId: number, version: number | null) => boolean
  // The connection to the backend is back: what changed meanwhile was not heard.
  recheck: () => void
  // A speaker merged or deleted: the backend rewrote its mentions in every note
  // without a new version, so the versions kept are rewritten too.
  followMentions: (change: MentionChange) => void
}

export interface NoteAutosaveOptions {
  // Saves the note from version (null: there was none), or deletes it with null.
  // Resolves with the new version (null when deleted); a 409 note_version_conflict
  // when the note is no longer at version.
  write: (transcriptId: number, doc: NoteDocument | null, version: number | null) => Promise<number | null>
  read: (transcriptId: number) => Promise<StoredNote>
  // What the editor has now, saved or not; undefined when it has nothing.
  local: (transcriptId: number) => NoteDocument | null | undefined
  // The note merged with a change from elsewhere, for the editor to show; writer is
  // who made that change.
  apply: (transcriptId: number, doc: NoteDocument, writer: NoteWriter | null) => void
  // A merge kept both versions of a block.
  onConflict: () => void
  // The first failure of a run of them; the document waits for the next try.
  onFailure: (error: unknown) => void
  delayMs?: number
}

const isConflict = (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === 'note_version_conflict'

// Saves notes one request at a time, newest document only, so an answer that comes
// late never stands for older text. Each write says the version it was made from;
// one refused as stale, or a change heard from elsewhere, reads the note and merges
// it with what was typed (mergeNotes), in the same line of requests. A failed save
// keeps its document until the next change or flush, unless a newer one has come since.
export function createNoteAutosave({
  write, read, local, apply, onConflict, onFailure, delayMs = NOTE_SAVE_DELAY_MS,
}: NoteAutosaveOptions): NoteAutosave {
  const waiting = new Map<number, NoteDocument>()
  // The note as the backend last had it, by what this saver read or wrote.
  const bases = new Map<number, StoredNote>()
  // Notes to read again before writing them.
  const stale = new Set<number>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let chain = Promise.resolve()
  let failing = false

  // Reads the note and merges it with what the editor has. What comes after the read
  // is taken at once, so typing during it is in the merge.
  const sync = async (id: number) => {
    const remote = await read(id)
    const known = bases.get(id)
    // Nothing new there; what was typed, if anything, is still waiting.
    if (known && known.version === remote.version) return
    // Never read before: what the editor has is all there is to keep.
    const base = known ?? remote
    const mine = local(id) ?? waiting.get(id) ?? base.content
    bases.set(id, remote)
    const merged = mergeNotes(base.content, mine, remote.content)
    const doc = merged.doc as NoteDocument
    if (merged.conflicts > 0) onConflict()
    if (!sameNote(doc, mine)) apply(id, doc, remote.writer ?? null)
    if (sameNote(doc, remote.content)) waiting.delete(id)
    else waiting.set(id, doc)
  }

  const save = async (id: number) => {
    const doc = waiting.get(id)!
    waiting.delete(id)
    const base = bases.get(id)!
    if (sameNote(doc, base.content)) return
    try {
      const empty = isEmptyNote(doc)
      const version = await write(id, empty ? null : doc, base.version)
      bases.set(id, { content: empty ? null : doc, version })
    } catch (error) {
      if (!waiting.has(id)) waiting.set(id, doc)
      throw error
    }
  }

  const run = async () => {
    for (;;) {
      const id = stale.values().next().value ?? waiting.keys().next().value
      if (id === undefined) return
      const reading = stale.has(id) || !bases.has(id)
      try {
        if (reading) {
          stale.delete(id)
          await sync(id)
        } else {
          await save(id)
        }
        failing = false
      } catch (error) {
        // The recording was deleted meanwhile: its note went with it.
        if (error instanceof ApiError && error.status === 404) {
          waiting.delete(id)
          bases.delete(id)
          continue
        }
        if (isConflict(error)) {
          stale.add(id)
          continue
        }
        if (reading) stale.add(id)
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
    loaded: (id, note) => {
      if (!bases.has(id)) bases.set(id, note)
    },
    heard: (id, version) => {
      const base = bases.get(id)
      if (!base) return waiting.has(id)
      if (base.version !== version) {
        stale.add(id)
        void flush()
      }
      return true
    },
    recheck: () => {
      for (const id of bases.keys()) stale.add(id)
      void flush()
    },
    followMentions: change => {
      for (const [id, base] of bases) {
        if (base.content) bases.set(id, { ...base, content: rewriteMentions(base.content, change) })
      }
    },
  }
}
