import { effectiveSpeaker, UNASSIGNED, type Segment, type Speaker } from '../../api/types'
import { formatDuration } from '../../media/timeline'
import { speakerColor, type SpeakerColor } from '../../styles/speaker-colors'
import { talkTimes, unknownSpeakerNames } from './transcript'

const GRAY: SpeakerColor = 6
const COLLAPSED_ROWS = 3

export interface SpeakerRowData {
  id: string
  kind: 'named' | 'unknown' | 'unassigned'
  name: string
  color: SpeakerColor
  seconds: number
  time: string
}

// The longest first and Unassigned last: it is not one person.
export function speakerRows(segments: readonly Segment[], speakers: readonly Speaker[]): SpeakerRowData[] {
  const known = new Map(speakers.map(speaker => [speaker.id, speaker]))
  const unknown = unknownSpeakerNames(segments, speakers)
  const rows = [...talkTimes(segments)].map(([id, seconds]): SpeakerRowData => {
    const time = formatDuration(seconds)
    if (id === UNASSIGNED) return { id, kind: 'unassigned', name: 'Unassigned', color: GRAY, seconds, time }
    const found = known.get(id)
    return found?.name
      ? { id, kind: 'named', name: found.name, color: speakerColor(found.color_index), seconds, time }
      : { id, kind: 'unknown', name: unknown.get(id)!, color: GRAY, seconds, time }
  })
  const rank = (row: SpeakerRowData) => (row.kind === 'unassigned' ? 1 : 0)
  return rows.sort((a, b) => rank(a) - rank(b) || b.seconds - a.seconds)
}

export const talkTotal = (rows: readonly SpeakerRowData[]) => rows.reduce((sum, row) => sum + row.seconds, 0)

// What stays in sight while the review takes the room: the current speaker always.
export function splitRows(rows: readonly SpeakerRowData[], currentId: string | null) {
  const visible = rows.slice(0, COLLAPSED_ROWS)
  if (currentId && rows.length > COLLAPSED_ROWS && !visible.some(row => row.id === currentId)) {
    visible[COLLAPSED_ROWS - 1] = rows.find(row => row.id === currentId) ?? visible[COLLAPSED_ROWS - 1]
  }
  return { visible, hidden: rows.filter(row => !visible.includes(row)) }
}

// Who needs a review, in the order they first speak. possibleMatches are recognized
// speakers to confirm: only stories have them until the backend keeps a confidence.
export function pendingReview(segments: readonly Segment[], speakers: readonly Speaker[], possibleMatches: readonly string[] = []): string[] {
  const unknown = unknownSpeakerNames(segments, speakers)
  const pending = new Set<string>()
  for (const segment of segments) {
    const id = effectiveSpeaker(segment)
    if (unknown.has(id) || possibleMatches.includes(id)) pending.add(id)
  }
  return [...pending]
}

export const firstSegmentOf = (segments: readonly Segment[], speakerId: string) =>
  segments.find(segment => effectiveSpeaker(segment) === speakerId)
