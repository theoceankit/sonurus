import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { IconButton } from '../IconButton/IconButton'
import { SectionHeader } from './SectionHeader'

const meta: Meta<typeof SectionHeader> = {
  component: SectionHeader,
  args: { title: 'Section title' },
}
export default meta

type Story = StoryObj<typeof SectionHeader>

const TRAILING = ['None', 'Meta', 'Action'] as const

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={TRAILING}
      wideCells
      rows={[{
        label: 'Trailing',
        render: trailing => {
          if (trailing === 'Meta') return <SectionHeader title="Section title" meta="13" />
          if (trailing === 'Action') return <SectionHeader title="Section title" action={<IconButton icon="search" label="Search" />} />
          return <SectionHeader title="Section title" />
        },
      }]}
    />
  ),
}

export const Example: Story = {}
