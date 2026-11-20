import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { TimecodeChip } from './TimecodeChip'

const meta: Meta<typeof TimecodeChip> = {
  component: TimecodeChip,
  args: { seconds: 754, onClick: () => {} },
}
export default meta

type Story = StoryObj<typeof TimecodeChip>

const STATES = ['Default', 'Hover', 'Pressed', 'Focus', 'Selected'] as const

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={STATES}
      rows={[
        { label: 'Minutes', render: state => <TimecodeChip seconds={754} selected={state === 'Selected'} /> },
        { label: 'Hours', render: state => <TimecodeChip seconds={3723} selected={state === 'Selected'} /> },
      ]}
    />
  ),
}

export const Example: Story = {}
export const Hours: Story = { args: { seconds: 3723 } }
export const Selected: Story = { args: { selected: true } }

// In a line of text, at the size of the note's body.
export const InText: Story = {
  render: args => (
    <p style={{ font: 'var(--font-body)', color: 'var(--color-text-primary)', margin: 0 }}>
      Anna asked to ship the import fix first <TimecodeChip {...args} /> and Mark agreed.
    </p>
  ),
}
