import type { Meta, StoryObj } from '@storybook/react-vite'
import { Stack } from './Stack'

const meta: Meta<typeof Stack> = {
  component: Stack,
  args: {
    gap: 2,
    children: [<span key="a">First</span>, <span key="b">Second</span>, <span key="c">Third</span>],
  },
  argTypes: { gap: { control: 'select', options: ['half', 1, 2, 3, 4, 5, 6, 8] } },
}
export default meta

type Story = StoryObj<typeof Stack>

export const Default: Story = {}
export const WithPadding: Story = { args: { padding: 4 } }
export const Centered: Story = { args: { align: 'center' } }
