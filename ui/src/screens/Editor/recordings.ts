import type { Speaker, TranscriptListItem } from '../../api/types'
import type { StackSpeaker } from '../../components/AvatarStack/AvatarStack'
import { speakerColor } from '../../styles/speaker-colors'

export interface RecordingSection {
  title: string
  items: TranscriptListItem[]
}

const THIS_WEEK_DAYS = 7

// created_at is local time with no zone, so its first ten characters are the date.
const dayOf = (createdAt: string, now: Date) => (createdAt ? new Date(`${createdAt.slice(0, 10)}T00:00:00`) : startOfDay(now))
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

// The boards' sections, worked out here: the API has its own (Today, Yesterday,
// Last week or a date). Calendar days back from today, as the backend counts them.
export function groupRecordings(items: TranscriptListItem[], now: Date, pinnedIds: number[] = []): RecordingSection[] {
  const start = startOfDay(now)
  start.setDate(start.getDate() - THIS_WEEK_DAYS)
  const pinned = pinnedIds.flatMap(id => items.filter(item => item.id === id))
  const rest = items.filter(item => !pinnedIds.includes(item.id))
  const sections: RecordingSection[] = [
    { title: 'Pinned', items: pinned },
    { title: 'This week', items: rest.filter(item => dayOf(item.created_at, now) >= start) },
    { title: 'Earlier', items: rest.filter(item => dayOf(item.created_at, now) < start) },
  ]
  return sections.filter(section => section.items.length > 0)
}

export function stackSpeakers(speakerIds: string[], speakers: Speaker[]): StackSpeaker[] {
  return speakerIds.map(id => {
    const found = speakers.find(speaker => speaker.id === id)
    return found?.name
      ? { id, name: found.name, color: speakerColor(found.color_index), title: found.name }
      : { id, kind: 'unknown' }
  })
}

export const deleteRecordingPrompt = (title: string) => ({
  title: title ? `Delete "${title}"?` : 'Delete this transcript?',
  body: 'The transcript and its recording made in Sonorus will be deleted. Imported audio files are kept.',
  warning: 'This cannot be undone.',
})

// Whether the open recording was deleted, by Delete all data or in another window:
// on the list before and not now. One the list has not had yet, such as a recording
// opened from the toast of a finished job before the list was read again, is not.
export function goneFromList(openId: number | null, before: readonly number[] | null, now: readonly number[]): boolean {
  return openId !== null && !!before?.includes(openId) && !now.includes(openId)
}

// The recordings in the list before and not now; none before the list first loads.
export function leftList(before: readonly number[] | null, now: readonly number[]): number[] {
  return before ? before.filter(id => !now.includes(id)) : []
}
