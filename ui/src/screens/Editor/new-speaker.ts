import { SPEAKER_COLORS } from '../../styles/speaker-colors'

export const GRAY_COLOR_INDEX = SPEAKER_COLORS.length - 1

// The colour a new speaker starts with: the least used, the first on a tie.
export function leastUsedColorIndex(speakers: readonly { color_index: number }[]): number {
  const uses = SPEAKER_COLORS.map(() => 0)
  for (const { color_index: index } of speakers) uses[index % uses.length]++
  uses.pop()
  return uses.indexOf(Math.min(...uses))
}

// Names need not be unique; this only makes a repeated one visible.
export function hasSpeakerNamed(speakers: readonly { name?: string | null }[], name: string): boolean {
  const wanted = name.trim().toLowerCase()
  return wanted !== '' && speakers.some(speaker => speaker.name?.trim().toLowerCase() === wanted)
}
