import type { Meta, StoryObj } from '@storybook/react-vite'
import { MetaItem } from './MetaItem'

const meta: Meta<typeof MetaItem> = {
  component: MetaItem,
  args: { icon: 'calendar', children: '4 Oct 2026, 02:33' },
}
export default meta

type Story = StoryObj<typeof MetaItem>

export const Date: Story = {}
export const Folder: Story = { args: { icon: 'folder', children: 'Interviews' } }
export const Language: Story = { args: { icon: 'globe', children: 'English' } }
