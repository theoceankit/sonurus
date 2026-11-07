export const BAR_COUNT = { large: 120, small: 26 }

// Before the levels of the audio are there, or when they cannot be: a flat row
// that says nothing about the audio.
export const FLAT_LEVEL = 0.25

export const FLAT_HEIGHTS = {
  large: Array<number>(BAR_COUNT.large).fill(FLAT_LEVEL),
  small: Array<number>(BAR_COUNT.small).fill(FLAT_LEVEL),
}

// How many bars of a small waveform fit its width, each as wide as
// --size-waveform-bar-small with the gap between them, so a wider clip gets more
// bars, not wider ones. Before the width is known it is BAR_COUNT.small.
export function smallBarCount(width: number, bar: number, gap: number) {
  if (!(width > 0) || !(bar > 0)) return BAR_COUNT.small
  return Math.max(1, Math.floor((width + gap) / (bar + gap)))
}

export const flatHeights = (count: number) => Array<number>(count).fill(FLAT_LEVEL)

// The heights on the Penpot board, in pixels of a waveform 32 and 18 tall, for
// stories: some audio to look at.
const LARGE = [
  11, 15, 12, 11, 14, 21, 15, 18, 25, 19, 23, 27, 27, 22, 18, 20, 19, 20, 15, 20, 12, 17, 9, 10, 10, 12, 13, 15, 17, 14,
  20, 12, 12, 17, 22, 13, 21, 19, 21, 15, 19, 18, 16, 16, 12, 16, 14, 13, 11, 10, 13, 10, 10, 13, 11, 13, 15, 19, 14, 12,
  17, 17, 19, 10, 17, 11, 13, 16, 12, 9, 12, 14, 11, 7, 8, 11, 17, 13, 16, 17, 15, 12, 17, 16, 23, 13, 21, 20, 18, 12,
  20, 17, 16, 16, 13, 14, 12, 11, 15, 10, 13, 17, 17, 15, 16, 18, 23, 17, 14, 15, 27, 26, 25, 25, 18, 17, 15, 21, 10, 15,
]
const SMALL = [6, 10, 14, 9, 16, 12, 7, 13, 18, 11, 8, 15, 10, 6, 12, 17, 9, 13, 7, 11, 14, 8, 12, 10, 6, 9]

export const BOARD_HEIGHTS = {
  large: LARGE.map(height => height / 32),
  small: SMALL.map(height => height / 18),
}
