import type { Meta, StoryObj } from '@storybook/react-vite'
import { barTurns, speakerBars, type Turn } from '../../media/timeline'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { Waveform } from './Waveform'
import styles from './Waveform.stories.module.css'

const meta: Meta<typeof Waveform> = { component: Waveform }
export default meta

type Story = StoryObj<typeof Waveform>

const turn = (start: number, end: number, color: SpeakerColor): Turn => ({ start, end, color, speaker: String(color), name: '' })

// The speakers of the board: Anna, Mark, Anna, an unknown one, Mark, Anna, Lena, Sofia, Anna.
const TURNS = [turn(0, 5, 5), turn(5, 10, 1), turn(10, 16, 5), turn(16, 25, 6), turn(27, 31, 4), turn(31, 38, 3), turn(38, 44, 1), turn(44, 47, 2), turn(47, 53, 5)]
const BARS = barTurns(TURNS, 120, 53).map(found => found?.color ?? null)

export const Small: Story = { args: { size: 'small', progress: 0.35 } }

export const SmallNothingPlayed: Story = { args: { size: 'small', progress: 0 } }

export const SmallAllPlayed: Story = { args: { size: 'small', progress: 1 } }

export const Large: Story = {
  args: { progress: 0.66, bars: BARS },
  decorators: [Story => <div className={styles.board}><Story /></div>],
}

export const LargeNothingPlayed: Story = { ...Large, args: { progress: 0, bars: BARS } }

export const LargeAllPlayed: Story = { ...Large, args: { progress: 1, bars: BARS } }

export const LargeNoSpeakers: Story = { ...Large, args: { progress: 0.66 } }

export const HoveredTurn: Story = { ...Large, args: { progress: 0.2, bars: BARS, highlight: [31 / 53, 38 / 53] } }

// A speaker under the pointer in the inspector: Mark, and the unknown one.
export const SpeakerHighlighted: Story = { ...Large, args: { progress: 0.66, bars: BARS, speakerBars: speakerBars(TURNS, '1', 120, 53) } }

export const UnknownSpeakerHighlighted: Story = { ...Large, args: { progress: 0.66, bars: BARS, speakerBars: speakerBars(TURNS, '6', 120, 53) } }

export const Narrow: Story = {
  args: { progress: 0.66, bars: BARS },
  decorators: [Story => <div className={styles.narrow}><Story /></div>],
}
