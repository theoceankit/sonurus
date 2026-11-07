import type { Meta, StoryObj } from '@storybook/react-vite'
import { Stack } from '../Stack/Stack'
import { DropZone } from './DropZone'
import styles from './DropZone.stories.module.css'

const meta: Meta<typeof DropZone> = {
  component: DropZone,
  args: { hint: 'wav, mp3, m4a, flac, ogg, mp4, mkv or webm' },
  decorators: [Story => <div className={styles.frame}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof DropZone>

// Drag a file from the system over it to see it light up.
export const Idle: Story = {}
// Files are over the zone.
export const Over: Story = { args: { over: true } }

export const AllStates: Story = {
  render: args => (
    <Stack gap={4}>
      <DropZone {...args} />
      <DropZone {...args} over />
    </Stack>
  ),
}
