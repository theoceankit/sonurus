import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { Turn } from '../../media/timeline'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { Player, type PlayerProps, type PlayerState } from './Player'
import styles from './Player.stories.module.css'

const turn = (start: number, end: number, name: string, color: SpeakerColor): Turn => ({ start, end, name, color, speaker: name })

const TURNS = [
  turn(0, 5, 'Anna Petrova', 5),
  turn(5, 10, 'Mark Ellis', 1),
  turn(10, 16, 'Anna Petrova', 5),
  turn(16, 25, 'Unknown speaker', 6),
  turn(27, 31, 'Lena Kovacs', 4),
  turn(31, 38, 'Oliver Grant', 3),
  turn(38, 44, 'Mark Ellis', 1),
  turn(44, 47, 'Sofia Ramos', 2),
  turn(47, 53, 'Anna Petrova', 5),
]

const PLAYING: PlayerState = { currentTime: 35, duration: 53, paused: false, rate: 1, volume: 1 }
const PAUSED: PlayerState = { ...PLAYING, paused: true }

// Everything works here except the audio: time moves when you seek.
function Stateful(props: PlayerProps) {
  const [state, setState] = useState(props.state)
  const change = (changes: Partial<PlayerState>) => setState(current => ({ ...current, ...changes }))
  return (
    <Player
      {...props}
      state={state}
      onToggle={() => setState(current => ({ ...current, paused: !current.paused }))}
      onSeek={currentTime => change({ currentTime })}
      onRateChange={rate => change({ rate })}
      onVolumeChange={volume => change({ volume })}
    />
  )
}

const meta: Meta<typeof Player> = {
  component: Player,
  args: { state: PLAYING, turns: TURNS },
  render: args => <Stateful {...args} />,
  decorators: [(Story, { parameters }) => <div className={parameters.narrow ? styles.narrow : styles.board}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof Player>

export const Playing: Story = {}

export const PlayingHover: Story = { args: { initialCursor: { at: 12 } } }

export const PlayingDragging: Story = { args: { initialCursor: { at: 35, dragging: true } } }

export const Paused: Story = { args: { state: PAUSED } }

export const PausedHover: Story = { args: { state: PAUSED, initialCursor: { at: 12 } } }

export const PausedDragging: Story = { args: { state: PAUSED, initialCursor: { at: 35, dragging: true } } }

export const HoverInAPause: Story = { args: { state: PAUSED, initialCursor: { at: 26 } } }

export const HoverAtTheEdges: Story = { args: { state: PAUSED, initialCursor: { at: 52.5 } } }

export const Disabled: Story = { args: { state: PAUSED, disabled: true } }

// A speaker under the pointer in the inspector.
export const SpeakerHighlighted: Story = { args: { state: PAUSED, highlightedSpeaker: 'Mark Ellis' } }

export const DisabledSpeakerHighlighted: Story = { args: { state: PAUSED, disabled: true, highlightedSpeaker: 'Mark Ellis' } }

export const DisabledNoAudio: Story = {
  args: { state: { ...PAUSED, currentTime: 0, duration: NaN }, disabled: true },
}

export const NoAudioFile: Story = { args: { state: { ...PAUSED, currentTime: 0 }, disabled: true, notice: 'Audio file not found' } }

export const Faster: Story = { args: { state: { ...PAUSED, rate: 1.5 } } }

export const Muted: Story = { args: { state: { ...PAUSED, volume: 0 } } }

export const OverAnHour: Story = {
  args: {
    state: { ...PAUSED, currentTime: 3725, duration: 10925 },
    turns: [turn(0, 4000, 'Anna Petrova', 5), turn(4000, 10925, 'Mark Ellis', 1)],
  },
}

export const Narrow: Story = { parameters: { narrow: true } }
