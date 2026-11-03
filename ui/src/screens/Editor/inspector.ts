import { effectiveSpeaker, UNASSIGNED, type Segment, type Speaker } from '../../api/types'
import { formatDuration } from '../../media/timeline'
import { scaleValue } from '../../styles/scale'
import { speakerColor, type SpeakerColor } from '../../styles/speaker-colors'
import { talkTimes, unknownSpeakerNames } from './transcript'

const GRAY: SpeakerColor = 6
// A speaker row and the gap between rows (SpeakerRow, Stack gap="half").
const ROW = scaleValue('--size-control-md')
const ROW_GAP = scaleValue('--space-half')
// More rows than this would be a list to read, not a glance: the rest wait behind Show N more.
const MAX_ROWS = 8

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

// How many rows a height holds.
export const rowSlots = (height: number) => Math.max(0, Math.floor((height + ROW_GAP) / (ROW + ROW_GAP)))

// What stays in sight in the room of `slots` rows: everyone if they fit, eight at
// most, otherwise the longest, the last place left for Show N more, and one speaker
// however little room. The speaker under review is always in sight, in the last
// place if not in their own. With the room not known yet, as if there were plenty.
export function splitRows(rows: readonly SpeakerRowData[], currentId: string | null, slots: number | null) {
  const room = slots ?? Infinity
  if (rows.length <= Math.min(room, MAX_ROWS)) return { visible: [...rows], hidden: [] }
  const shown = Math.max(1, Math.min(room - 1, MAX_ROWS))
  const visible = rows.slice(0, shown)
  const current = currentId ? rows.find(row => row.id === currentId) : undefined
  if (current && !visible.includes(current)) visible[shown - 1] = current
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
