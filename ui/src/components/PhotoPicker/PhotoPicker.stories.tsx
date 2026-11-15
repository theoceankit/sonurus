import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { PhotoPicker } from './PhotoPicker'

const meta: Meta<typeof PhotoPicker> = {
  component: PhotoPicker,
  args: { label: 'Photo', hasPhoto: false, onPick: () => {}, onRemove: () => {} },
}
export default meta

type Story = StoryObj<typeof PhotoPicker>

// Choose a picture: the crop window opens, and Save gives the speaker a photo.
function Live() {
  const [hasPhoto, setHasPhoto] = useState(false)
  return <PhotoPicker label="Photo" hasPhoto={hasPhoto} onPick={() => setHasPhoto(true)} onRemove={() => setHasPhoto(false)} />
}

export const Default: Story = { render: () => <Live /> }
export const NoPhoto: Story = {}
export const WithPhoto: Story = { args: { hasPhoto: true } }
export const NoLabel: Story = { args: { label: undefined, hasPhoto: true } }
export const Busy: Story = { args: { hasPhoto: true, busy: true } }
export const NeedsName: Story = { args: { disabled: true, hint: 'Add a name to add a photo.' } }
export const Refused: Story = { args: { hasPhoto: true, error: 'The photo is larger than 2 MB' } }
