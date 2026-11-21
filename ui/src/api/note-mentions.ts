import type { MentionChange } from '../components/NoteEditor/note-content'

type Listener = (change: MentionChange) => void

const listeners = new Set<Listener>()

// Notes open in an editor hear of a speaker merged or deleted: the editor keeps its
// own document and saves it over the backend's, so it rewrites its mentions too.
export function onMentionChange(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function announceMentionChange(change: MentionChange) {
  for (const listener of [...listeners]) listener(change)
}
