import * as RadioGroup from '@radix-ui/react-radio-group'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { ColorSwatch } from './ColorSwatch'

const meta: Meta<typeof ColorSwatch> = {
  component: ColorSwatch,
  args: { color: 1, label: 'Blue' },
  decorators: [Story => <RadioGroup.Root value="1"><Story /></RadioGroup.Root>],
}
export default meta

type Story = StoryObj<typeof ColorSwatch>

const STATES = ['Default', 'Hover', 'Pressed', 'Focus', 'Disabled'] as const

const row = (label: string, selected: boolean) => ({
  label,
  render: (state: (typeof STATES)[number]) => (
    <RadioGroup.Root value={selected ? '1' : ''} aria-label={label}>
      <ColorSwatch color={1} label="Blue" disabled={state === 'Disabled'} />
    </RadioGroup.Root>
  ),
})

export const Matrix: Story = {
  decorators: [],
  render: () => <StateMatrix states={STATES} rows={[row('Off', false), row('On', true)]} />,
}

export const Example: Story = {}
