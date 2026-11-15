import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import portrait from '../../api/fixtures/photos/portrait-1.jpg'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { Button } from '../Button/Button'
import { AvatarModal } from './AvatarModal'

const ANNA = { name: 'Anna Petrova', color: 1 } as const

const meta: Meta<typeof AvatarModal> = {
  component: AvatarModal,
  args: { speaker: ANNA, preview: true, onColorChange: () => {}, onPick: () => {}, onRemove: () => {}, onClose: () => {} },
}
export default meta

type Story = StoryObj<typeof AvatarModal>

export const NoPhoto: Story = {}
export const WithPhoto: Story = { args: { speaker: { ...ANNA, photo: portrait } } }
export const OtherColour: Story = { args: { speaker: { ...ANNA, color: 4 } } }
// Files over the avatar, before the drop.
export const FilesOver: Story = {
  play: async ({ canvasElement }) => {
    const zone = [...canvasElement.ownerDocument.querySelectorAll('span')].find(span => span.textContent?.startsWith('Drop a picture'))?.parentElement
    const data = new DataTransfer()
    data.items.add(new File(['x'], 'me.jpg', { type: 'image/jpeg' }))
    zone?.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data }))
  },
}
export const Crop: Story = { args: { initialSrc: portrait } }
export const WrongFile: Story = { args: { initialError: 'Choose a JPEG, PNG or WebP picture.' } }
export const SaveRefused: Story = { args: { initialSrc: portrait, initialError: 'The photo is larger than 2 MB' } }

// Opened for real: drop or choose a picture, crop it, change the colour.
function Live() {
  const [open, setOpen] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const [color, setColor] = useState<SpeakerColor>(1)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Avatar</Button>
      {open && (
        <AvatarModal
          speaker={{ ...ANNA, color, photo }}
          onColorChange={setColor}
          onPick={(blob: Blob) => setPhoto(URL.createObjectURL(blob))}
          onRemove={() => setPhoto(null)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
export const Open: Story = { render: () => <Live /> }
