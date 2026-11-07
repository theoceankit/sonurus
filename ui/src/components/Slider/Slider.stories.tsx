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

const scaleMarks = [50, 100, 150, 200].map(value => ({ value, label: `${value}%` }))

export const Horizontal: Story = {
  render: args => {
    const [value, setValue] = useState(args.value)
    return <div style={{ width: 240 }}><Slider {...args} value={value} onChange={setValue} /></div>
  },
  args: { label: 'Interface scale', orientation: 'horizontal', min: 50, max: 200, step: 5, value: 100 },
}

export const HorizontalWithMarks: Story = {
  ...Horizontal,
  args: { ...Horizontal.args, marks: scaleMarks, valueText: value => `${value}%` },
}

export const HorizontalAtTheEnds: Story = {
  render: args => (
    <div style={{ display: 'grid', gap: 24, width: 240 }}>
      <Slider {...args} value={50} />
      <Slider {...args} value={200} />
    </div>
  ),
  args: HorizontalWithMarks.args,
}

export const HorizontalDisabled: Story = { ...Horizontal, args: { ...HorizontalWithMarks.args, disabled: true } }
