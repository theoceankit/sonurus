import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { ClipPlayer } from './ClipPlayer'
import styles from './ClipPlayer.stories.module.css'

const noop = () => {}

const meta: Meta<typeof ClipPlayer> = {
  component: ClipPlayer,
  decorators: [Story => <div className={styles.clip}><Story /></div>],
  args: { progress: 0, duration: '0:04', onToggle: noop },
}
export default meta

type Story = StoryObj<typeof ClipPlayer>

export const Matrix: Story = {
  decorators: [],
  render: () => (
    <StateMatrix
      wideCells
      states={['Paused', 'Playing'] as const}
      rows={[
        { label: 'No toggle', render: state => <div className={styles.clip}><ClipPlayer progress={state === 'Playing' ? 0.4 : 0} duration="0:04" playing={state === 'Playing'} /></div> },
        { label: 'Collapsed', render: state => <div className={styles.clip}><ClipPlayer progress={state === 'Playing' ? 0.4 : 0} duration="0:04" playing={state === 'Playing'} onToggleText={noop} /></div> },
        { label: 'Expanded', render: state => <div className={styles.clip}><ClipPlayer progress={state === 'Playing' ? 0.4 : 0} duration="0:04" playing={state === 'Playing'} textExpanded onToggleText={noop} /></div> },
      ]}
    />
  ),
}

export const Paused: Story = {}
export const Playing: Story = { args: { playing: true, progress: 0.4 } }
export const Collapsed: Story = { args: { onToggleText: noop } }
export const Expanded: Story = { args: { onToggleText: noop, textExpanded: true } }
export const NoAudio: Story = { args: { disabled: true, onToggleText: noop } }
export const LongClip: Story = { args: { duration: '0:29', onToggleText: noop } }
