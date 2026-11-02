import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Slider } from './Slider'

const meta: Meta<typeof Slider> = { component: Slider, args: { label: 'Volume', value: 0.6 } }
export default meta

type Story = StoryObj<typeof Slider>

export const Default: Story = {
  render: args => {
    const [value, setValue] = useState(args.value)
    return <Slider {...args} value={value} onChange={setValue} />
  },
}

export const Empty: Story = { args: { value: 0 } }

export const Full: Story = { args: { value: 1 } }

export const Focus: Story = { ...Default, parameters: { pseudo: { focusVisible: true } } }

export const Disabled: Story = { args: { disabled: true } }
