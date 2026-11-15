import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import portrait from '../../api/fixtures/photos/portrait-1.jpg'
import { Button } from '../Button/Button'
import { PhotoModal } from './PhotoModal'

const ANNA = { name: 'Anna Petrova', color: 1 } as const

const meta: Meta<typeof PhotoModal> = {
  component: PhotoModal,
  args: { speaker: ANNA, preview: true, onPick: () => {}, onRemove: () => {}, onClose: () => {} },
}
export default meta

type Story = StoryObj<typeof PhotoModal>

export const NoPhoto: Story = {}
export const WithPhoto: Story = { args: { speaker: { ...ANNA, photo: portrait } } }
export const Crop: Story = { args: { initialSrc: portrait } }
export const WrongFile: Story = { args: { initialError: 'Choose a JPEG, PNG or WebP picture.' } }
export const SaveRefused: Story = { args: { initialSrc: portrait, initialError: 'The photo is larger than 2 MB' } }

// Opened for real: choose a picture, crop it, Save.
function Live() {
  const [open, setOpen] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Photo</Button>
      {open && (
        <PhotoModal
          speaker={{ ...ANNA, photo }}
          onPick={blob => setPhoto(URL.createObjectURL(blob))}
          onRemove={() => setPhoto(null)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
export const Open: Story = { render: () => <Live /> }
