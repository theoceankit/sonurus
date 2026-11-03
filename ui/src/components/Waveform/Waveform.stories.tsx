import type { Meta, StoryObj } from '@storybook/react-vite'
import { barTurns, speakerBars, type Turn } from '../../media/timeline'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { BOARD_HEIGHTS } from './bars'
import { Waveform } from './Waveform'
import styles from './Waveform.stories.module.css'

const meta: Meta<typeof Waveform> = { component: Waveform }
export default meta

type Story = StoryObj<typeof Waveform>

const turn = (start: number, end: number, color: SpeakerColor): Turn => ({ start, end, color, speaker: String(color), name: '' })

// The speakers of the board: Anna, Mark, Anna, an unknown one, Mark, Anna, Lena, Sofia, Anna.
const TURNS = [turn(0, 5, 5), turn(5, 10, 1), turn(10, 16, 5), turn(16, 25, 6), turn(27, 31, 4), turn(31, 38, 3), turn(38, 44, 1), turn(44, 47, 2), turn(47, 53, 5)]
const BARS = barTurns(TURNS, 120, 53).map(found => found?.color ?? null)
const LARGE = BOARD_HEIGHTS.large
const SMALL = BOARD_HEIGHTS.small
// Levels as the backend gives them for a recording with silences: the quiet
// bars keep the smallest height, so the speaker's colour still shows.
const WITH_SILENCE = LARGE.map((height, i) => (i % 30 < 6 ? 0 : height))

export const Small: Story = { args: { size: 'small', progress: 0.35, heights: SMALL } }

export const SmallNothingPlayed: Story = { args: { size: 'small', progress: 0, heights: SMALL } }

export const SmallAllPlayed: Story = { args: { size: 'small', progress: 1, heights: SMALL } }

export const Large: Story = {
  args: { progress: 0.66, bars: BARS, heights: LARGE },
  decorators: [Story => <div className={styles.board}><Story /></div>],
}

export const LargeNothingPlayed: Story = { ...Large, args: { progress: 0, bars: BARS, heights: LARGE } }

export const LargeAllPlayed: Story = { ...Large, args: { progress: 1, bars: BARS, heights: LARGE } }

export const LargeNoSpeakers: Story = { ...Large, args: { progress: 0.66, heights: LARGE } }

export const HoveredTurn: Story = { ...Large, args: { progress: 0.2, bars: BARS, heights: LARGE, highlight: [31 / 53, 38 / 53] } }

// A speaker under the pointer in the inspector: Mark, and the unknown one.
export const SpeakerHighlighted: Story = { ...Large, args: { progress: 0.66, bars: BARS, speakerBars: speakerBars(TURNS, '1', 120, 53), heights: LARGE } }

export const UnknownSpeakerHighlighted: Story = { ...Large, args: { progress: 0.66, bars: BARS, speakerBars: speakerBars(TURNS, '6', 120, 53), heights: LARGE } }

// The levels of the audio are not there yet, or could not be had.
export const SmallLevelsNotReady: Story = { args: { size: 'small', progress: 0.35 } }

export const LargeLevelsNotReady: Story = { ...Large, args: { progress: 0.66, bars: BARS } }

export const LargeWithSilence: Story = { ...Large, args: { progress: 0.66, bars: BARS, heights: WITH_SILENCE } }

export const SpeakerHighlightedWithSilence: Story = {
  ...Large,
  args: { progress: 0.66, bars: BARS, speakerBars: speakerBars(TURNS, '1', 120, 53), heights: WITH_SILENCE },
}

export const Narrow: Story = {
  args: { progress: 0.66, bars: BARS, heights: LARGE },
  decorators: [Story => <div className={styles.narrow}><Story /></div>],
}
