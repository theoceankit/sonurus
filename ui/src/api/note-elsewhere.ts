import type { NoteDocument, NoteWriter } from './types'

// A note changed elsewhere (an agent through MCP), merged with what was typed here:
// the document the open editor is to show.
export interface NoteFromElsewhere {
  transcriptId: number
  doc: NoteDocument
  // Who made the change, where known.
  writer: NoteWriter | null
}

type Listener = (note: NoteFromElsewhere) => void

const listeners = new Set<Listener>()

// The editor keeps its own document; it hears here when the note is to change under it.
export function onNoteFromElsewhere(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function announceNoteFromElsewhere(note: NoteFromElsewhere) {
  for (const listener of [...listeners]) listener(note)
}
