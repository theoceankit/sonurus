import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { Disclosure } from './Disclosure'

const meta: Meta<typeof Disclosure> = {
  component: Disclosure,
  args: { label: 'Optional details', children: 'Handle goes here.' },
}
export default meta

type Story = StoryObj<typeof Disclosure>

const STATES = ['Default', 'Hover', 'Pressed', 'Focus', 'Disabled'] as const

const row = (label: string, expanded: boolean) => ({
  label,
  render: (state: (typeof STATES)[number]) => (
    <Disclosure label="Optional details" expanded={expanded} disabled={state === 'Disabled'}>{null}</Disclosure>
  ),
})

export const Matrix: Story = {
  render: () => <StateMatrix states={STATES} rows={[row('Off', false), row('On', true)]} />,
}

export const Example: Story = {}
export const Expanded: Story = { args: { defaultExpanded: true } }
