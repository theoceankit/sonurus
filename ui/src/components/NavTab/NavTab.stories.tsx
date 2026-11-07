import type { Meta, StoryObj } from '@storybook/react-vite'
import { Tabs } from '../Tabs/Tabs'
import { NavTab } from './NavTab'

const meta: Meta<typeof NavTab> = {
  component: NavTab,
  args: { value: 'models', icon: 'models', children: 'Models' },
  decorators: [(Story, { args }) => (
    <Tabs orientation="vertical" aria-label="Settings" defaultValue={args.value === 'models' ? 'general' : 'models'} tabs={<div style={{ width: 184 }}><Story /></div>} />
  )],
}
export default meta

type Story = StoryObj<typeof NavTab>

export const Default: Story = {}

export const Selected: Story = { args: { value: 'general', icon: 'settings', children: 'General' } }

export const Hover: Story = { parameters: { pseudo: { hover: true } } }

export const Focus: Story = { parameters: { pseudo: { focusVisible: true } } }

export const Disabled: Story = { args: { disabled: true } }

export const LongLabel: Story = { args: { children: 'A section with a much longer name' } }
