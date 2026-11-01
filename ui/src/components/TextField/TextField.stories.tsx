import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { StateMatrix } from '../../foundations/StateMatrix'
import { TextField } from './TextField'

const meta: Meta<typeof TextField> = {
  component: TextField,
  args: { label: 'Label', placeholder: 'Speaker name' },
}
export default meta

type Story = StoryObj<typeof TextField>

const STATES = ['Default', 'Hover', 'Focus', 'Disabled', 'Error'] as const
type State = (typeof STATES)[number]

const forState = (state: State) => ({
  disabled: state === 'Disabled',
  error: state === 'Error' ? 'Enter a name' : undefined,
})

const row = (label: string, props: object) => ({
  label,
  render: (state: State) => (
    <TextField label="Label" placeholder="Speaker name" onChange={() => {}} {...props} {...forState(state)} />
  ),
})

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={STATES}
      fields
      rows={[
        row('Placeholder', {}),
        row('Filled', { value: 'Anna Petrova' }),
        row('Optional', { optional: true }),
        row('Prefix', { prefix: '@', value: 'anna.petrova' }),
        row('Helper', { helper: 'Helper text' }),
        row('No label', { label: undefined, 'aria-label': 'Speaker name' }),
      ]}
    />
  ),
}

function Live() {
  const [value, setValue] = useState('')
  return (
    <TextField
      label="Name"
      placeholder="Speaker name"
      value={value}
      onChange={event => setValue(event.target.value)}
      error={value ? undefined : 'Enter a name'}
    />
  )
}

export const Example: Story = { render: () => <Live /> }
