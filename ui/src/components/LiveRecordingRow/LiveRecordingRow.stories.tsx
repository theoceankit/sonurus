import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { LiveRecordingRow } from './LiveRecordingRow'
import styles from './LiveRecordingRow.stories.module.css'

const noop = () => {}

const meta: Meta<typeof LiveRecordingRow> = {
  component: LiveRecordingRow,
  args: { title: '7 Nov 18:30 Meeting', phase: 'live', elapsed: '12:34', onStop: noop },
  decorators: [Story => <div className={styles.column}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof LiveRecordingRow>

const STATES = ['Default', 'Hover', 'Focus'] as const
const row = (label: string, props: Partial<Parameters<typeof LiveRecordingRow>[0]>, skip: (typeof STATES)[number][] = []) => ({
  label,
  skip,
  render: () => <div className={styles.column}><LiveRecordingRow title="7 Nov 18:30 Meeting" phase="live" elapsed="12:34" onStop={noop} {...props} /></div>,
})

export const Matrix: Story = {
  decorators: [Story => <Story />],
  render: () => (
    <StateMatrix
      states={STATES}
      rows={[
        row('Live', {}),
        row('Starting', { phase: 'starting' }, ['Focus']),
        row('Stopping', { phase: 'stopping' }, ['Focus']),
      ]}
    />
  ),
}

// The dot breathes; Stop comes in under the pointer.
export const Live: Story = {}
export const Starting: Story = { args: { phase: 'starting' } }
export const Stopping: Story = { args: { phase: 'stopping' } }
// Past an hour the time has hours.
export const LongRecording: Story = { args: { elapsed: '1:02:03' } }
export const LongTitle: Story = { args: { title: 'Quarterly planning with the whole product and design group, second half' } }
