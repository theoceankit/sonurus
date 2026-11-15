import type { Meta, StoryObj } from '@storybook/react-vite'
import portrait from '../../api/fixtures/photos/portrait-1.jpg'
import { StateMatrix } from '../../foundations/StateMatrix'
import { AvatarButton } from './AvatarButton'

const meta: Meta<typeof AvatarButton> = {
  component: AvatarButton,
  args: { speaker: { name: 'Anna Petrova', color: 1 }, label: 'Change avatar' },
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
        { label: 'Photo', render: () => <AvatarButton speaker={{ name: 'Anna Petrova', color: 1, photo: portrait }} label="Change avatar" /> },
        { label: 'Remove photo', render: () => <AvatarButton speaker={{ name: 'Anna Petrova', color: 1, photo: portrait }} label="Remove photo" icon="delete" size="xlarge" /> },
      ]}
    />
  ),
}
export const Initials: Story = {}
export const Photo: Story = { args: { speaker: { name: 'Anna Petrova', color: 1, photo: portrait } } }
export const Disabled: Story = { args: { disabled: true } }
// In the Avatar window: a bin over the photo removes it.
export const RemovePhoto: Story = { args: { speaker: { name: 'Anna Petrova', color: 1, photo: portrait }, label: 'Remove photo', icon: 'delete', size: 'xlarge' } }
// Files over it, before the drop.
export const FilesOver: Story = {
  args: { onFileDrop: () => {} },
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector('button')!
    const data = new DataTransfer()
    data.items.add(new File(['x'], 'me.jpg', { type: 'image/jpeg' }))
    button.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data }))
  },
}
