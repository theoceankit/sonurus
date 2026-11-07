import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { BOARD_HEIGHTS } from '../Waveform/bars'
import { VoiceClip } from './VoiceClip'
import styles from './VoiceClip.stories.module.css'

const noop = () => {}
const TEXT = 'That was me. Files over two hours took a long time to copy.'
const LONG_TEXT = 'I went through a long meeting with it yesterday, and the part that helped most was hearing a voice before choosing, because names in the list mean little when you have not met everyone, and a short clip tells you more than any percentage.'

const meta: Meta<typeof VoiceClip> = {
  component: VoiceClip,
  decorators: [Story => <div className={styles.box}><Story /></div>],
  args: { duration: '0:04', text: TEXT, progress: 0, heights: BOARD_HEIGHTS.small, onToggle: noop },
}
export default meta

type Story = StoryObj<typeof VoiceClip>

export const Matrix: Story = {
  decorators: [],
  render: () => (
    <StateMatrix
      wideCells
      states={['Paused', 'Playing'] as const}
      rows={[
        { label: 'Text folded', render: state => <div className={styles.box}><VoiceClip duration="0:04" text={TEXT} heights={BOARD_HEIGHTS.small} playing={state === 'Playing'} progress={state === 'Playing' ? 0.4 : 0} /></div> },
        { label: 'Text open', render: state => <div className={styles.box}><VoiceClip duration="0:04" text={TEXT} heights={BOARD_HEIGHTS.small} playing={state === 'Playing'} progress={state === 'Playing' ? 0.4 : 0} initialTextExpanded /></div> },
        { label: 'No text', render: state => <div className={styles.box}><VoiceClip duration="0:04" text="" heights={BOARD_HEIGHTS.small} playing={state === 'Playing'} progress={state === 'Playing' ? 0.4 : 0} /></div> },
      ]}
    />
  ),
}

export const Paused: Story = {}
export const Playing: Story = { args: { playing: true, progress: 0.4 } }
export const TextOpen: Story = { args: { initialTextExpanded: true } }
// Six lines at most, then the text scrolls.
export const LongText: Story = { args: { duration: '0:15', text: LONG_TEXT, initialTextExpanded: true } }
export const NoText: Story = { args: { text: '' } }
// The audio is gone.
export const NoAudio: Story = { args: { disabled: true } }
// The clip is on its way: no levels and no text yet.
export const Loading: Story = { args: { disabled: true, text: '', heights: null, duration: '0:00' } }
