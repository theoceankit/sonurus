import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { RecordingPill } from './RecordingPill'

const noop = () => {}

const meta: Meta<typeof RecordingPill> = {
  component: RecordingPill,
  args: { phase: 'live', elapsed: '12:34', onStop: noop },
}
export default meta

type Story = StoryObj<typeof RecordingPill>

const STATES = ['Default', 'Hover', 'Focus', 'Pressed'] as const

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={STATES}
      rows={[
        { label: 'Live', render: () => <RecordingPill phase="live" elapsed="12:34" onStop={noop} /> },
        { label: 'Starting', skip: ['Hover', 'Focus', 'Pressed'], render: () => <RecordingPill phase="starting" elapsed="0:00" onStop={noop} /> },
        { label: 'Stopping', skip: ['Hover', 'Focus', 'Pressed'], render: () => <RecordingPill phase="stopping" elapsed="12:34" onStop={noop} /> },
      ]}
    />
  ),
}

// The arrow opens the menu with Stop recording.
export const Live: Story = {}
export const Starting: Story = { args: { phase: 'starting' } }
export const Stopping: Story = { args: { phase: 'stopping' } }
export const LongRecording: Story = { args: { elapsed: '1:02:03' } }
