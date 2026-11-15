import type { Meta, StoryObj } from '@storybook/react-vite'
import wide from '../../api/fixtures/photos/landscape.jpg'
import portrait from '../../api/fixtures/photos/portrait-1.jpg'
import { PhotoCrop } from './PhotoCrop'
import styles from './PhotoCrop.stories.module.css'

const meta: Meta<typeof PhotoCrop> = {
  component: PhotoCrop,
  args: { src: portrait },
  decorators: [Story => <div className={styles.frame}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof PhotoCrop>

export const Default: Story = {}
export const Zoomed: Story = { args: { initialZoom: 2 } }
// A wide picture starts in its middle; drag it sideways.
export const Wide: Story = { args: { src: wide } }
