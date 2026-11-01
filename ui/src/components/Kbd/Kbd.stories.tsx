import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { Kbd } from './Kbd'

const meta: Meta<typeof Kbd> = {
  component: Kbd,
  args: { keys: ['mod', 'K'] },
}
export default meta

type Story = StoryObj<typeof Kbd>

const SYSTEMS = ['Linux / Windows', 'macOS'] as const
const os = (system: (typeof SYSTEMS)[number]) => (system === 'macOS' ? 'mac' : 'other')

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={SYSTEMS}
      rows={[
        { label: 'Key', render: s => <Kbd keys={['mod', 'K']} os={os(s)} /> },
        { label: 'Two modifiers', render: s => <Kbd keys={['mod', 'shift', 'F']} os={os(s)} /> },
      ]}
    />
  ),
}

export const ThisSystem: Story = {}
