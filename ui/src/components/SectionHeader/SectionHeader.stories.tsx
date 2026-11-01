import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconButton } from '../IconButton/IconButton'
import { SectionHeader } from './SectionHeader'

const meta: Meta<typeof SectionHeader> = {
  component: SectionHeader,
  args: { title: 'Section title' },
  decorators: [Story => <div style={{ width: '284px' }}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof SectionHeader>

export const None: Story = {}
export const Meta_: Story = { name: 'Meta', args: { meta: '13' } }
export const Action: Story = { args: { action: <IconButton icon="search" label="Search" /> } }
