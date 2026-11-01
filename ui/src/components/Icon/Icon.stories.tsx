import type { Meta, StoryObj } from '@storybook/react-vite'
import { Icon } from './Icon'
import { iconNames } from './icon-names'

const meta: Meta<typeof Icon> = {
  component: Icon,
  args: { name: 'search', size: 16 },
  argTypes: {
    name: { control: 'select', options: iconNames },
    size: { control: 'inline-radio', options: [12, 14, 16, 20, 24] },
  },
}
export default meta

type Story = StoryObj<typeof Icon>

export const Default: Story = {}
export const Size12: Story = { args: { size: 12 } }
export const Size14: Story = { args: { name: 'sparkle', size: 14 } }
export const Size20: Story = { args: { size: 20 } }
export const Size24: Story = { args: { size: 24 } }
export const Filled: Story = { args: { name: 'play', size: 24 } }
export const Logo: Story = { args: { name: 'whisper-model', size: 24 } }
export const Labelled: Story = { args: { label: 'Search' } }
