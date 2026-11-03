import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import type { SegmentTiming } from '../../media/playing-bar'
import { Paragraph } from './Paragraph'
import styles from './Paragraph.stories.module.css'

// A recording standing where a story wants it. Eight seconds, so that the bar is seen to move.
const at = (currentTime: number, paused: boolean): SegmentTiming => ({
  start: 0,
  end: 8,
  playback: {
    getState: () => ({ currentTime, duration: 8, paused, rate: 1, volume: 1, status: 'ready' }),
    subscribe: () => () => {},
    load: () => {},
    reload: () => {},
    toggle: () => {},
    seek: () => {},
    setRate: () => {},
    setVolume: () => {},
  },
})

const TEXT = 'Right. The queue work landed, and so far nobody has reported a crash.'

const meta: Meta<typeof Paragraph> = {
  component: Paragraph,
  args: { text: TEXT, color: 1 },
  decorators: [Story => <div className={styles.column}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof Paragraph>

// Editing has its own story: its field takes the focus and would scroll the matrix.
const STATES = ['Default', 'Hover', 'Focus', 'Playing'] as const

export const Matrix: Story = {
  decorators: [Story => <div className={styles.matrix}><Story /></div>],
  render: () => (
    <StateMatrix
      wideCells
      states={STATES}
      rows={[{
        label: 'Paragraph',
        render: state => (
          <Paragraph
            text={TEXT}
            color={1}
            showActions={state === 'Hover'}
            playing={state === 'Playing'}
          />
        ),
      }]}
    />
  ),
}

export const Default: Story = {}
export const WithActions: Story = { args: { showActions: true } }
export const Playing: Story = { args: { playing: true } }
export const PlayingUnknown: Story = { args: { playing: true, color: 6 } }
export const BarRunning: Story = { args: { playing: true, timing: at(0, false) } }
export const BarPaused: Story = { args: { playing: true, timing: at(3.2, true) } }
export const BarAtTheStart: Story = { args: { playing: true, timing: at(0, true) } }
export const BarAtTheEnd: Story = { args: { playing: true, timing: at(8, true) } }
export const Editing: Story = { args: { editing: true } }
export const LongWord: Story = { args: { text: `A word that does not fit ${'x'.repeat(200)}` } }
