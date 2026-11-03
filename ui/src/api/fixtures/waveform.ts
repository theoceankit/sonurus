import type { WaveformStretch } from '../client'
import type { Segment } from '../types'

// Levels for the fixtures: loud where someone speaks, quiet in the pauses, and
// the same on every run.
export function fixtureLevels(segments: readonly Segment[], { bars, start, end }: WaveformStretch): number[] {
  return Array.from({ length: bars }, (_, i) => {
    const at = start + ((i + 0.5) / bars) * (end - start)
    const segment = segments.find(s => s.start <= at && at < s.end)
    if (!segment) return 0.04
    const wobble = Math.abs(Math.sin(at * 12.9898 + segment.start * 78.233) * 43758.5453) % 1
    return 0.45 + 0.55 * wobble
  })
}
