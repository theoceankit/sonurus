import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { Badge } from './Badge'

const meta: Meta<typeof Badge> = {
  component: Badge,
  args: { children: 'Interview', variant: 'label', tone: 'neutral' },
}
export default meta

type Story = StoryObj<typeof Badge>

const TONES = ['Neutral', 'Accent', 'Success', 'Warning', 'Danger', 'On accent'] as const
const TEXT = { Neutral: 'Interview', Accent: 'Recommended', Success: 'Downloaded', Warning: 'Same name', Danger: 'Failed', 'On accent': 'Same name' }
const tone = (label: (typeof TONES)[number]) =>
  (label === 'On accent' ? 'onAccent' : label.toLowerCase()) as 'neutral' | 'onAccent'

const onAccent = (state: string) => (state === 'On accent' ? { background: 'var(--color-accent-fg)' } : undefined)

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={TONES}
      rows={[
        { label: 'Label', render: t => <span style={onAccent(t)}><Badge tone={tone(t)}>{TEXT[t]}</Badge></span> },
        {
          label: 'Count',
          skip: ['Accent', 'Success', 'Warning', 'Danger'],
          render: t => <span style={onAccent(t)}><Badge variant="count" tone={tone(t)}>6</Badge></span>,
        },
      ]}
    />
  ),
}

export const Example: Story = {}
export const CountOfZero: Story = { args: { variant: 'count', children: 0 } }
