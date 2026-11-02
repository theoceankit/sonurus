import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { ColorPicker } from './ColorPicker'

const meta: Meta<typeof ColorPicker> = {
  component: ColorPicker,
  args: { label: 'Colour', value: 1, onValueChange: () => {} },
}
export default meta

type Story = StoryObj<typeof ColorPicker>

function Live() {
  const [value, setValue] = useState<SpeakerColor>(1)
  return <ColorPicker label="Colour" value={value} onValueChange={setValue} />
}

export const Default: Story = { render: () => <Live /> }
export const ThirdChosen: Story = { args: { value: 3 } }
export const NoLabel: Story = { args: { label: undefined, 'aria-label': 'Colour' } }
export const Disabled: Story = { args: { disabled: true } }
export const SomeColours: Story = { args: { colors: [1, 2, 3, 4, 5] } }
