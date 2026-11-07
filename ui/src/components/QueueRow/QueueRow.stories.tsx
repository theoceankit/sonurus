import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { IconButton } from '../IconButton/IconButton'
import { Stack } from '../Stack/Stack'
import { QueueRow } from './QueueRow'
import styles from './QueueRow.stories.module.css'

const retry = <IconButton variant="ghost" size="xs" icon="retry" label="Retry" />
const more = <IconButton variant="ghost" size="xs" icon="more" label="More" />

const meta: Meta<typeof QueueRow> = {
  component: QueueRow,
  args: { title: 'Weekly product sync', status: 'waiting' },
  decorators: [Story => <div className={styles.column}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof QueueRow>

const STATES = ['Default', 'Hover', 'Focus'] as const

const row = (label: string, props: Partial<Parameters<typeof QueueRow>[0]>) => ({
  label,
  render: () => <div className={styles.column}><QueueRow title="Weekly product sync" status="waiting" {...props} /></div>,
})

export const Matrix: Story = {
  decorators: [Story => <Story />],
  render: () => (
    <StateMatrix
      states={STATES}
      rows={[
        row('Running', { status: 'running', actions: more }),
        row('Waiting', { actions: more }),
        row('Failed', { status: 'failed', actions: <>{retry}{more}</> }),
        row('Failed Selected', { status: 'failed', actions: <>{retry}{more}</>, selected: true }),
        
      ]}
    />
  ),
}

// The title glints now and then; with reduced motion it is plain.
export const Running: Story = { args: { status: 'running', actions: more } }
export const Waiting: Story = { args: { actions: more } }
export const Failed: Story = { args: { status: 'failed', actions: retry } }
export const Selected: Story = { args: { status: 'failed', actions: retry, selected: true } }
export const LongTitle: Story = {
  args: { status: 'failed', actions: retry, title: 'A title long enough that it has to be cut at the end of the row' },
}

// While a row is dragged: the dragged one is dimmed, the line shows where it lands.
export const Dragging: Story = {
  render: () => (
    <Stack gap="half" align="stretch">
      <QueueRow title="Weekly product sync" status="running" />
      <QueueRow title="Design review" status="waiting" drop="after" />
      <QueueRow title="Interview with Lena" status="waiting" />
      <QueueRow title="All-hands" status="waiting" dragging />
    </Stack>
  ),
}
