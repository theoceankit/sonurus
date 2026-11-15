import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { SPEAKER_COLORS } from '../../styles/speaker-colors'
import portrait from '../../api/fixtures/photos/portrait-1.jpg'
import { Avatar, type AvatarSize } from './Avatar'

// An address that never loads: the initials stay.
const BROKEN = 'data:image/jpeg;base64,AAAA'

const meta: Meta<typeof Avatar> = {
  component: Avatar,
  args: { name: 'Anna Petrova', color: 1, size: 'medium' },
}
export default meta

type Story = StoryObj<typeof Avatar>

const SIZES = ['XS', 'Small', 'Medium', 'Large', 'XLarge'] as const
const size = (label: (typeof SIZES)[number]) => label.toLowerCase() as AvatarSize

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={SIZES}
      rows={[
        ...SPEAKER_COLORS.map(color => ({
          label: `Speaker ${color}`,
          render: (s: (typeof SIZES)[number]) => <Avatar name="Anna Petrova" color={color} size={size(s)} />,
        })),
        { label: 'One word', render: s => <Avatar name="Mark" color={2} size={size(s)} /> },
        { label: 'Empty name', render: s => <Avatar name="" color={3} size={size(s)} /> },
        { label: 'Photo', render: s => <Avatar name="Anna Petrova" color={1} photo={portrait} size={size(s)} /> },
        { label: 'Photo that fails', render: s => <Avatar name="Anna Petrova" color={1} photo={BROKEN} size={size(s)} /> },
        { label: 'Unknown', render: s => <Avatar kind="unknown" size={size(s)} /> },
        { label: 'Unassigned', render: s => <Avatar kind="unassigned" size={size(s)} /> },
      ]}
    />
  ),
}

export const Example: Story = {}

export const WithPhoto: Story = { args: { photo: portrait, size: 'large' } }
