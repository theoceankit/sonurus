// The six speaker colours of tokens.css (--color-speaker-N-*).
export const SPEAKER_COLORS = [1, 2, 3, 4, 5, 6] as const
export type SpeakerColor = (typeof SPEAKER_COLORS)[number]
