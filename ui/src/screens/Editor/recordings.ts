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

// A speaker with no name is unrecognized. The API has no such flag on a recording.
export const needsReview = (speakerIds: string[], speakers: Speaker[]) =>
  speakerIds.some(id => !speakers.find(speaker => speaker.id === id)?.name)
