import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { notImplementedProps } from '../../not-implemented'
import { Toggle } from './Toggle'

const meta: Meta<typeof Toggle> = { component: Toggle, args: { label: 'Timestamps', checked: false } }
export default meta

type Story = StoryObj<typeof Toggle>

export const Default: Story = {
  render: args => {
    const [checked, setChecked] = useState(args.checked)
    return <Toggle {...args} checked={checked} onChange={setChecked} />
  },
}

export const Off: Story = {}

export const On: Story = { args: { checked: true } }

export const Hover: Story = { parameters: { pseudo: { hover: true } } }

export const Focus: Story = { args: { checked: true }, parameters: { pseudo: { focusVisible: true } } }

export const Disabled: Story = { args: { disabled: true } }

export const DisabledOn: Story = { args: { disabled: true, checked: true } }

export const NotImplemented: Story = { args: { checked: true, ...notImplementedProps('story.toggle') } }
