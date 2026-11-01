import type { Meta, StoryObj } from '@storybook/react-vite'
import { Inline } from './Inline'

const meta: Meta<typeof Inline> = {
  component: Inline,
  args: {
    gap: 2,
    children: [<span key="a">First</span>, <span key="b">Second</span>, <span key="c">Third</span>],
  },
  argTypes: { gap: { control: 'select', options: ['half', 1, 2, 3, 4, 5, 6, 8] } },
}
export default meta

type Story = StoryObj<typeof Inline>

export const Default: Story = {}
export const WithPadding: Story = { args: { padding: 4 } }
export const SpaceBetween: Story = { args: { justify: 'between' } }
export const Wrapping: Story = { args: { wrap: true, style: { maxWidth: 'var(--size-control-lg)' } } }
