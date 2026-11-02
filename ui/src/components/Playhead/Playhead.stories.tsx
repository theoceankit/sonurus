import type { Meta, StoryObj } from '@storybook/react-vite'
import { Playhead } from './Playhead'
import styles from './Playhead.stories.module.css'

const meta: Meta<typeof Playhead> = {
  component: Playhead,
  args: { position: 0.5 },
  decorators: [Story => <div className={styles.track}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof Playhead>

export const Default: Story = {}

export const Hover: Story = { args: { look: 'hover', time: '00:35' } }

export const HoverWithName: Story = { args: { look: 'hover', time: '00:35', name: 'Anna Petrova' } }

export const LongName: Story = {
  args: { look: 'hover', time: '1:02:05', name: 'Alexandrina Montgomery-Featherstonehaugh the Third' },
}
