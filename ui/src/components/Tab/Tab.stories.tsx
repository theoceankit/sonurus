import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { Tabs } from '../Tabs/Tabs'
import { Tab } from './Tab'

const meta: Meta<typeof Tab> = {
  component: Tab,
  args: { value: 'a', children: 'Transcripts' },
  decorators: [Story => <Tabs aria-label="Sections" value="a" tabs={<Story />} />],
}
export default meta

type Story = StoryObj<typeof Tab>

const STATES = ['Default', 'Hover', 'Pressed', 'Focus', 'Disabled'] as const
type State = (typeof STATES)[number]

const row = (label: string, selected: boolean, count?: number) => ({
  label,
  render: (state: State) => (
    <Tabs
      aria-label={label}
      value={selected ? 'a' : 'b'}
      tabs={<Tab value="a" count={count} disabled={state === 'Disabled'}>Transcripts</Tab>}
    />
  ),
})

export const Matrix: Story = {
  decorators: [],
  render: () => (
    <StateMatrix
      states={STATES}
      rows={[
        row('Off', false),
        row('On', true),
        row('Off with count', false, 6),
        row('On with count', true, 6),
      ]}
    />
  ),
}

export const Example: Story = {}
export const WithCount: Story = { args: { count: 6 } }
