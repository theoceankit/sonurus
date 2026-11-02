// The six speaker colours of tokens.css (--color-speaker-N-*).
export const SPEAKER_COLORS = [1, 2, 3, 4, 5, 6] as const
export type SpeakerColor = (typeof SPEAKER_COLORS)[number]

// What a speaker can be given: the API keeps five, and the sixth, gray, means unknown.
export const ASSIGNABLE_SPEAKER_COLORS = [1, 2, 3, 4, 5] as const satisfies readonly SpeakerColor[]

// The backend stores a colour as an index from 0; a speaker's avatar takes it from here.
export const speakerColor = (colorIndex: number): SpeakerColor => SPEAKER_COLORS[colorIndex % SPEAKER_COLORS.length]
