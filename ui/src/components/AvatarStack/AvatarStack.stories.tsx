import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { AvatarStack, type StackSpeaker } from './AvatarStack'

const SPEAKERS: StackSpeaker[] = [
  { id: 'a', name: 'Anna Petrova', color: 5, title: 'Anna Petrova' },
  { id: 'b', name: 'Mark Ellis', color: 1, title: 'Mark Ellis' },
  { id: 'c', name: 'Lena Kovacs', color: 4, title: 'Lena Kovacs' },
  { id: 'd', kind: 'unknown', title: 'Unknown speaker 1' },
  { id: 'e', name: 'Sofia Reyes', color: 3, title: 'Sofia Reyes' },
]

const meta: Meta<typeof AvatarStack> = {
  component: AvatarStack,
  args: { speakers: SPEAKERS, size: 'small', max: 3 },
}
export default meta

type Story = StoryObj<typeof AvatarStack>

const SIZES = ['XS', 'Small'] as const
const size = (label: (typeof SIZES)[number]) => label.toLowerCase() as 'xs' | 'small'

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={SIZES}
      rows={[
        { label: 'Three', render: s => <AvatarStack speakers={SPEAKERS.slice(0, 3)} size={size(s)} /> },
        { label: 'Three and more', render: s => <AvatarStack speakers={SPEAKERS} size={size(s)} max={3} /> },
        { label: 'One', render: s => <AvatarStack speakers={SPEAKERS.slice(0, 1)} size={size(s)} /> },
        { label: 'With unknown', render: s => <AvatarStack speakers={SPEAKERS.slice(2, 5)} size={size(s)} /> },
      ]}
    />
  ),
}

export const Example: Story = {}
