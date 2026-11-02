import type { SpeakerColor } from '../styles/speaker-colors'

// A segment as the player sees it: who speaks and how to show them.
export interface Turn {
  start: number
  end: number
  speaker: string
  name: string
  color: SpeakerColor
}

const pad = (value: number) => String(value).padStart(2, '0')

export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const hours = Math.floor(total / 3600)
  const clock = `${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`
  return hours ? `${hours}:${clock}` : clock
}

// What the player shows for the audio element.
export function playerClock(audio: { currentTime: number; duration: number; paused: boolean }) {
  return {
    elapsed: formatClock(audio.currentTime || 0),
    total: formatClock(audio.duration),
    playing: !audio.paused,
  }
}

// Index of the segment playing at time t (start ≤ t < end) in segments sorted by
// start, or -1. Binary search: runs on every timeupdate.
export function activeSegmentIndex(segments: readonly { start: number; end: number }[], t: number): number {
  let lo = 0
  let hi = segments.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const segment = segments[mid]
    if (segment.end <= t) lo = mid + 1
    else if (segment.start > t) hi = mid - 1
    else return mid
  }
  return -1
}

// Segments of two speakers may overlap, so this is the first that contains t.
export const turnAt = (turns: readonly Turn[], t: number): Turn | null =>
  turns.find(turn => t >= turn.start && t < turn.end) ?? null

// Where each run of one speaker starts, and the run that t is in. A pause belongs
// to the run before it.
function speakerBlocks(turns: readonly Turn[], t: number) {
  const starts = turns.filter((turn, i) => i === 0 || turn.speaker !== turns[i - 1].speaker).map(turn => turn.start)
  return { starts, current: starts.reduce((found, start, i) => (start <= t ? i : found), 0) }
}

export function previousSpeakerTime(turns: readonly Turn[], t: number): number | null {
  const { starts, current } = speakerBlocks(turns, t)
  return starts[current - 1] ?? null
}

export function nextSpeakerTime(turns: readonly Turn[], t: number): number | null {
  const { starts, current } = speakerBlocks(turns, t)
  return starts[current + 1] ?? null
}

export const skipTime = (t: number, seconds: number, duration: number) => Math.max(0, Math.min(t + seconds, duration))

// The audio knows best, the segments draw the timeline until it does.
export function timelineDuration(audioDuration: number, turns: readonly Turn[]): number {
  if (Number.isFinite(audioDuration) && audioDuration > 0) return audioDuration
  return turns.reduce((end, turn) => Math.max(end, turn.end), 0)
}

export function barTurns(turns: readonly Turn[], count: number, duration: number): (Turn | null)[] {
  return Array.from({ length: count }, (_, i) => (duration > 0 ? turnAt(turns, ((i + 0.5) / count) * duration) : null))
}
