import type { QueueSnapshot, Speaker, SpeakerUpdate } from '../../api/types'
import { normalizeHandle } from './handles'

export type SpeakersCategory = 'all' | 'named' | 'unnamed'

export const UNNAMED_SPEAKER = 'Unnamed speaker'

// Names that differ only by case or spaces are the same name.
const nameKey = (name: string | null | undefined) => (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export const speakerDisplayName = (speaker: Pick<Speaker, 'name'>) => speaker.name || UNNAMED_SPEAKER

// A search looks at the name and the handle (a leading @ in it is left out), so a
// speaker without a name, who has no handle either, never matches it.
export function filterSpeakers<T extends Pick<Speaker, 'name'> & { handle?: string | null }>(speakers: readonly T[], query: string, category: SpeakersCategory): T[] {
  const typed = nameKey(query)
  const search = typed.replace(/^@+/, '')
  return speakers.filter(speaker => {
    if (category === 'named' && !speaker.name) return false
    if (category === 'unnamed' && speaker.name) return false
    if (!typed) return true
    return !!speaker.name && (nameKey(speaker.name).includes(search) || (speaker.handle ?? '').includes(search))
  })
}

export function categoryCounts(speakers: readonly Pick<Speaker, 'name'>[]): Record<SpeakersCategory, number> {
  const named = speakers.filter(speaker => speaker.name).length
  return { all: speakers.length, named, unnamed: speakers.length - named }
}

// Speakers whose name another speaker also has. Allowed, since the id is the person,
// but shown so the two can be told apart.
export function duplicateNameIds(speakers: readonly Pick<Speaker, 'id' | 'name'>[]): Set<string> {
  const byName = new Map<string, string[]>()
  for (const { id, name } of speakers) {
    if (!name) continue
    const key = nameKey(name)
    byName.set(key, [...(byName.get(key) ?? []), id])
  }
  return new Set([...byName.values()].filter(ids => ids.length > 1).flat())
}

// How much a speaker is heard: the recordings and the time, as separate values.
export function speakerUsage({ transcripts, duration_sec: seconds }: Pick<Speaker, 'transcripts' | 'duration_sec'>) {
  return transcripts ? { recordings: plural(transcripts, 'recording'), time: seconds } : { recordings: 'Not in any recording', time: null }
}

export function deleteSpeakerPrompt({ name, segments, transcripts }: Pick<Speaker, 'name' | 'segments' | 'transcripts'>) {
  const effect = segments ? `${plural(segments, 'segment')} in ${plural(transcripts, 'recording')} will become Unassigned. ` : ''
  return {
    title: name ? `Delete "${name}"?` : 'Delete this speaker?',
    body: `${effect}The voice profile is removed, so this speaker will no longer be recognized in new recordings. This cannot be undone.`,
  }
}

// Why a speaker cannot be deleted now, or null. A running job holds its own copy of
// the voices and would write the speaker back when it saves; the backend refuses too.
export function deleteBlockReason(queue: Pick<QueueSnapshot, 'running_job_id' | 'recording'> | undefined): string | null {
  if (queue?.running_job_id) return 'Pause the transcription queue first.'
  if (queue?.recording) return 'Stop the recording first.'
  return null
}

// Who to show after a speaker leaves the list: the next one, else the one before.
export function speakerAfter(ids: readonly string[], gone: string): string | null {
  const at = ids.indexOf(gone)
  if (at === -1) return null
  return ids[at + 1] ?? ids[at - 1] ?? null
}

// When a speaker was last heard: 4 Oct 2026.
export function formatLastSeen(iso: string): string {
  const date = new Date(iso)
  if (!iso || Number.isNaN(date.getTime())) return 'Never'
  return `${date.getDate()} ${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getFullYear()}`
}

// What the card holds until Save: the name, colour and handle as edited, of one
// speaker. handle is null until the handle field is typed in: the card then shows the
// handle the backend gives, which follows the name unless it was set by hand.
export interface SpeakerDraft {
  id: string
  name: string
  colorIndex: number
  handle: string | null
}

type Saved = Pick<Speaker, 'id' | 'name' | 'color_index' | 'handle' | 'handle_manual'>

export const speakerDraft = (speaker: Saved): SpeakerDraft => ({ id: speaker.id, name: speaker.name ?? '', colorIndex: speaker.color_index, handle: null })

// What Save sends for the handle, or undefined: one typed that differs from the saved
// one, or '' to go back to the one made from the name when it was set by hand.
function handleChange(draft: SpeakerDraft, saved: Saved): string | undefined {
  if (draft.handle === null) return undefined
  const handle = normalizeHandle(draft.handle)
  if (!handle) return saved.handle_manual ? '' : undefined
  return handle !== saved.handle ? handle : undefined
}

// Anything edited, a blank name too: Cancel and the question on leaving cover it.
export const draftDirty = (draft: SpeakerDraft, saved: Saved) =>
  draft.name.trim() !== (saved.name ?? '') || draft.colorIndex !== saved.color_index || handleChange(draft, saved) !== undefined

// What Save sends, or null when there is nothing it can send. A blank name is not
// saved: a speaker keeps the name they had.
export function draftChanges(draft: SpeakerDraft, saved: Saved): SpeakerUpdate | null {
  const name = draft.name.trim()
  if (!name && saved.name) return null
  const update: SpeakerUpdate = {}
  if (name && name !== saved.name) update.name = name
  if (draft.colorIndex !== saved.color_index) update.color_index = draft.colorIndex
  const handle = handleChange(draft, saved)
  if (handle !== undefined) update.handle = handle
  return Object.keys(update).length ? update : null
}
