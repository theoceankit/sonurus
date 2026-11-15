import type { Meta, StoryObj } from '@storybook/react-vite'
import portrait from '../../api/fixtures/photos/portrait-1.jpg'
import { StateMatrix } from '../../foundations/StateMatrix'
import { AvatarButton } from './AvatarButton'

const meta: Meta<typeof AvatarButton> = {
  component: AvatarButton,
  args: { speaker: { name: 'Anna Petrova', color: 1 }, label: 'Change photo' },
}
export default meta

type Story = StoryObj<typeof AvatarButton>

const STATES = ['Default', 'Hover', 'Focus'] as const

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={STATES}
      rows={[
        { label: 'Initials', render: () => <AvatarButton speaker={{ name: 'Anna Petrova', color: 1 }} label="Add photo" /> },
        { label: 'Photo', render: () => <AvatarButton speaker={{ name: 'Anna Petrova', color: 1, photo: portrait }} label="Change photo" /> },
      ]}
    />
  ),
}
export const Initials: Story = {}
export const Photo: Story = { args: { speaker: { name: 'Anna Petrova', color: 1, photo: portrait } } }
export const Disabled: Story = { args: { disabled: true } }
