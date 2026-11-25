import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useApi } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { announceNoteFromElsewhere } from '../../api/note-elsewhere'
import { onMentionChange } from '../../api/note-mentions'
import { queryKeys, setHasNote, useKeepNote, useWriteNote } from '../../api/queries'
import type { Note } from '../../api/types'
import { toast } from '../../components/Toast/toast-store'
import { onBeforeClose } from '../../platform/before-close'
import { createNoteAutosave, type NoteAutosave } from './note-autosave'

const failure = (error: unknown) => (error instanceof ApiError && error.status === 0
  ? 'the backend is not reachable'
  : error instanceof Error ? error.message : String(error))

export const NOTE_CONFLICT_MESSAGE = 'Notes changed elsewhere while you typed: both versions of a paragraph are kept'

// One saver for the notes of the screen: it saves about a second after typing stops,
// and at once when the recording shown changes, when the screen goes and before the
// window closes. A failure says so once; the text stays in the editor and is tried
// again with the next change or the next of those moments.
//
// It follows WS /ws/events too: a note changed elsewhere is read and merged with what
// was typed, into the cache and the open editor; one it does not keep leaves the
// cache, to be read again when it opens.
export function useNotesSaver(shownId: number | null): NoteAutosave {
  const api = useApi()
  const queries = useQueryClient()
  const write = useWriteNote()
  const keep = useKeepNote()
  // The saver is made once; what it uses is the one of the latest render.
  const latest = useRef({ api, write, keep })
  latest.current = { api, write, keep }
  const [saver] = useState(() => createNoteAutosave({
    write: (id, doc, version) => latest.current.write(id, doc, version),
    read: async id => {
      const { content, version, writer } = await latest.current.api.getNote(id)
      return { content, version, writer }
    },
    local: id => queries.getQueryData<Note>(queryKeys.note(id))?.content,
    apply: (id, doc, writer) => {
      latest.current.keep(id, doc)
      announceNoteFromElsewhere({ transcriptId: id, doc, writer })
    },
    onConflict: () => toast({ message: NOTE_CONFLICT_MESSAGE }),
    onFailure: error => toast({ message: `Failed to save notes: ${failure(error)}`, type: 'error' }),
  }))

  useEffect(() => onBeforeClose(saver.flush), [saver])
  useEffect(() => () => { void saver.flush() }, [saver])
  // Leaving a recording, for another one, a job or nothing.
  useEffect(() => { void saver.flush() }, [saver, shownId])
  useEffect(() => onMentionChange(change => saver.followMentions(change)), [saver])
  useEffect(() => api.subscribeAppEvents(event => {
    // Connected, first or again: what changed while away was not heard.
    if (event.type === 'connected') {
      saver.recheck()
      return
    }
    setHasNote(queries, event.transcript_id, event.version !== null)
    if (!saver.heard(event.transcript_id, event.version)) {
      queries.removeQueries({ queryKey: queryKeys.note(event.transcript_id), exact: true })
    }
  }), [api, queries, saver])
  return saver
}
