import type { Meta, StoryObj } from '@storybook/react-vite'
import portrait from '../../api/fixtures/photos/portrait-1.jpg'
import wide from '../../api/fixtures/photos/landscape.jpg'
import { PhotoCropModal } from './PhotoCropModal'

const meta: Meta<typeof PhotoCropModal> = {
  component: PhotoCropModal,
  args: { src: portrait, preview: true, onSave: () => {}, onClose: () => {} },
}
export default meta

type Story = StoryObj<typeof PhotoCropModal>

export const Default: Story = {}
export const Zoomed: Story = { args: { initialZoom: 2 } }
// A wide picture starts in its middle; drag it sideways.
export const Wide: Story = { args: { src: wide } }
export const SaveRefused: Story = {
  args: { onSave: () => Promise.reject(new Error('The photo is larger than 2 MB')) },
  play: async ({ canvasElement }) => {
    const save = [...canvasElement.querySelectorAll('button')].find(button => button.textContent === 'Save')
    // The picture loads first, then Save works.
    await new Promise(resolve => setTimeout(resolve, 300))
    save?.click()
  },
}
// Opened for real, over the page.
export const Open: Story = { args: { preview: false } }
